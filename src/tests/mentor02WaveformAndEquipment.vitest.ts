import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EnvironmentConfig,
  RFConfig,
  type ManualFec,
  type ManualModulation,
} from '../core/config';
import {
  LinkBudgetEngine,
  MODCOD_TABLE,
  resolveManualModCod,
} from '../core/linkBudget';
import {
  getReferenceConstellation,
  resolveConstellationInfo,
} from '../core/vsaConstellationEngine';
import { getModcodIdentifier } from '../core/pduDissector';
import {
  MAX_TACTICAL_EQUIPMENT,
  TacticalEquipmentRegistry,
  computeAggregateJammerInterferenceDbm,
} from '../core/tacticalEquipment';
import { SimulationWorkerManager } from '../worker/simWorker';
import { TerrainEngine } from '../core/terrain';
import type { TelemetryFrame } from '../shared/workerProtocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const MODULATIONS: readonly ManualModulation[] = [
  'QPSK',
  '8-PSK',
  '16-QAM',
  '16-APSK',
  '32-APSK',
  '64-APSK',
];

const FECS: readonly ManualFec[] = ['1/2', '2/3', '3/4', '5/6'];
const MOD_ORDERS: Readonly<Record<ManualModulation, number>> = {
  'QPSK': 4,
  '8-PSK': 8,
  '16-QAM': 16,
  '16-APSK': 16,
  '32-APSK': 32,
  '64-APSK': 64,
};
const FEC_VALUES: Readonly<Record<ManualFec, number>> = {
  '1/2': 0.5,
  '2/3': 2 / 3,
  '3/4': 0.75,
  '5/6': 5 / 6,
};

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('MENTOR-02: Manual Modulation/FEC Lock & Multi-Equipment Tactical RF Spawner', () => {
  it('validates all 24 manual (modulation x FEC) entries, monotonicity, 16-QAM vs 16-APSK threshold, and OUTAGE cutoff', () => {
    for (const mod of MODULATIONS) {
      let prevSnr = Number.NEGATIVE_INFINITY;
      let prevEff = 0;
      for (const fec of FECS) {
        const entry = resolveManualModCod(mod, fec);
        expect(entry.name).toBe(`${mod} ${fec}`);
        expect(Number.isFinite(entry.minSnrDb)).toBe(true);
        expect(Number.isFinite(entry.spectralEfficiencyBpsHz)).toBe(true);
        const expectedEff = Math.log2(MOD_ORDERS[mod]) * FEC_VALUES[fec] * 0.99;
        expect(entry.spectralEfficiencyBpsHz).toBeCloseTo(expectedEff, 9);
        expect(entry.minSnrDb).toBeGreaterThan(prevSnr);
        expect(entry.spectralEfficiencyBpsHz).toBeGreaterThan(prevEff);
        prevSnr = entry.minSnrDb;
        prevEff = entry.spectralEfficiencyBpsHz;
      }
    }

    for (const fec of FECS) {
      let prevSnr = Number.NEGATIVE_INFINITY;
      for (const mod of MODULATIONS) {
        const entry = resolveManualModCod(mod, fec);
        expect(entry.minSnrDb).toBeGreaterThan(prevSnr);
        prevSnr = entry.minSnrDb;
      }
      const qam = resolveManualModCod('16-QAM', fec);
      const apsk = resolveManualModCod('16-APSK', fec);
      expect(apsk.minSnrDb - qam.minSnrDb).toBeCloseTo(0.4, 6);
    }

    // Manual 16-QAM 3/4 link budget enforcement
    const lockedEntry = resolveManualModCod('16-QAM', '3/4');
    const above = LinkBudgetEngine.selectModCod(
      lockedEntry.minSnrDb + 0.5,
      new RFConfig({ mcsMode: 'manual_lock', manualModulation: '16-QAM', manualFec: '3/4' })
    );
    expect(above.name).toBe('16-QAM 3/4');
    expect(above.spectralEfficiencyBpsHz).toBeCloseTo(4 * 0.75 * 0.99, 9);

    const below = LinkBudgetEngine.selectModCod(
      lockedEntry.minSnrDb - 0.5,
      new RFConfig({ mcsMode: 'manual_lock', manualModulation: '16-QAM', manualFec: '3/4' })
    );
    expect(below.name).toBe('OUTAGE');
    expect(below.spectralEfficiencyBpsHz).toBe(0);

    // evaluateLink honors manual_lock outage (0 bps)
    const engine = new LinkBudgetEngine();
    const rfManual = new RFConfig({ mcsMode: 'manual_lock', manualModulation: '64-APSK', manualFec: '5/6' });
    const env = new EnvironmentConfig({ rainRateMmH: 0 });
    const forcedOutage = engine.evaluateLink('soldier', 30000, 15.0, rfManual, env);
    expect(forcedOutage.isOutage).toBe(true);
    expect(forcedOutage.modcodName).toBe('OUTAGE');
    expect(forcedOutage.bitrateBps).toBe(0);

    // Default ACM Auto remains bit-identical to MODCOD_TABLE
    const rfDefault = new RFConfig();
    expect(rfDefault.mcsMode).toBe('acm_auto');
    for (const snr of [-5, -1.5, 2.5, 5.5, 8.0, 11.5, 14.0, 17.5, 22.0, 28.0]) {
      const expected = MODCOD_TABLE.find((m) => snr >= m.minSnrDb) ?? {
        name: 'LINK_OUTAGE',
        spectralEfficiencyBpsHz: 0,
        minSnrDb: Number.NEGATIVE_INFINITY,
      };
      const got = LinkBudgetEngine.selectModCod(snr, rfDefault);
      expect(got.name).toBe(expected.name);
      expect(got.spectralEfficiencyBpsHz).toBe(expected.spectralEfficiencyBpsHz);
    }
  });

  it('produces exact 4x4 rectangular unit-energy 16-QAM constellation distinct from concentric 16-APSK', () => {
    const qam16 = getReferenceConstellation('16-QAM 3/4');
    const apsk16 = getReferenceConstellation('16-APSK 3/4');
    expect(qam16).toHaveLength(16);
    expect(apsk16).toHaveLength(16);

    const meanEnergy = qam16.reduce((acc, p) => acc + p.i * p.i + p.q * p.q, 0) / qam16.length;
    expect(meanEnergy).toBeCloseTo(1.0, 6);

    // 4x4 grid has exactly 4 distinct I levels and 4 distinct Q levels: {±1, ±3}/sqrt(10)
    const invSqrt10 = 1 / Math.sqrt(10);
    const iSet = new Set(qam16.map((p) => Number((p.i / invSqrt10).toFixed(4))));
    const qSet = new Set(qam16.map((p) => Number((p.q / invSqrt10).toFixed(4))));
    expect([...iSet].sort((a, b) => a - b)).toEqual([-3, -1, 1, 3]);
    expect([...qSet].sort((a, b) => a - b)).toEqual([-3, -1, 1, 3]);

    // Distinct from concentric 4+12 ring 16-APSK
    const qamRadii = new Set(qam16.map((p) => Number(Math.hypot(p.i, p.q).toFixed(4))));
    const apskRadii = new Set(apsk16.map((p) => Number(Math.hypot(p.i, p.q).toFixed(4))));
    expect(qamRadii.size).toBe(3); // sqrt(2)/sqrt(10), sqrt(10)/sqrt(10), sqrt(18)/sqrt(10)
    expect(apskRadii.size).toBe(2); // 2 concentric rings

    // VSA info & PDU dissector identifier recognition
    const info = resolveConstellationInfo('16-QAM 3/4');
    expect(info.constellationType).toBe('16-QAM');
    expect(info.minSnrDb).toBeCloseTo(12.4, 6);
    expect(getModcodIdentifier('16-QAM 3/4')).not.toBe(getModcodIdentifier('16-APSK 3/4'));
  });

  it('enforces equipment registry validation, -Infinity empty jammer fast path, and linear mW multi-jammer summation', () => {
    const reg = new TacticalEquipmentRegistry();
    expect(reg.add({ type: 'barrage_jammer', xM: Number.NaN, yM: 0 }).accepted).toBe(false);
    expect(reg.add({ type: 'barrage_jammer', xM: 900000, yM: 0 }).accepted).toBe(false);

    const clamped = reg.add({ type: 'relay_mast', xM: 1000, yM: 2000, eirpDbm: 120, heightAglM: 250 });
    expect(clamped.accepted).toBe(true);
    expect(clamped.item?.eirpDbm).toBe(90);
    expect(clamped.item?.heightAglM).toBe(100);
    reg.clear();

    for (let i = 0; i < MAX_TACTICAL_EQUIPMENT; i++) {
      expect(reg.add({ type: 'esm_sensor', xM: i * 100, yM: 0 }).accepted).toBe(true);
    }
    expect(reg.add({ type: 'esm_sensor', xM: 5000, yM: 0 }).accepted).toBe(false);

    // Pure empty fast path returns -Infinity
    const terrain = new TerrainEngine('synthetic');
    const rf = new RFConfig();
    const env = new EnvironmentConfig({ jammerEnabled: false });
    expect(
      computeAggregateJammerInterferenceDbm({
        equipment: [],
        acnPos: [0, 0, 5000],
        terrainEngine: terrain,
        rfConfig: rf,
        envConfig: env,
      })
    ).toBe(Number.NEGATIVE_INFINITY);
  });

  it('runs real SimulationWorkerManager multi-equipment lifecycle (+3.01 dB linear jammer sum, relay/ESM telemetry, delete/clear)', () => {
    const worker = new SimulationWorkerManager(0, '16_NODES');
    const emittedFrames: TelemetryFrame[] = [];
    (worker as unknown as { emitHostMessage: (m: unknown) => void }).emitHostMessage = (m: unknown) => {
      const msg = m as { type?: string; frame?: TelemetryFrame };
      if (msg?.type === 'TELEMETRY_FRAME' && msg.frame) {
        emittedFrames.push(msg.frame);
      }
    };

    const getLatestFrame = (): TelemetryFrame => {
      worker.handleMessage({ type: 'SIM_CONTROL', action: 'step' });
      return emittedFrames[emittedFrames.length - 1];
    };

    const baseFrame = getLatestFrame();
    expect(baseFrame.mcs_mode).toBe('acm_auto');
    expect(baseFrame.tactical_equipment).toBeUndefined();
    const baseNode4Sinr = baseFrame.nodes_telemetry.find((n) => n.node_id === 4)!.snr_db;

    // 1. Add first barrage jammer at (4000, 4000)
    const add1 = worker.handleMessage({
      type: 'EQUIPMENT_ADD',
      id: 'jmr-1',
      equipment_type: 'barrage_jammer',
      x_m: 4000,
      y_m: 4000,
      eirp_dbm: 65,
    });
    expect(add1.accepted).toBe(true);
    const frameOneJammer = getLatestFrame();
    expect(frameOneJammer.tactical_equipment).toHaveLength(1);
    const oneJammerInterfDbm = Math.max(...(frameOneJammer.jammer_sector_interference_dbm ?? [-150]));
    const oneJammerNode4Sinr = frameOneJammer.nodes_telemetry.find((n) => n.node_id === 4)!.snr_db;
    expect(oneJammerNode4Sinr).toBeLessThan(baseNode4Sinr);

    // 2. Add second equidistant, equal-EIRP barrage jammer at identical coordinates -> +3.01 dB linear mW sum
    const add2 = worker.handleMessage({
      type: 'EQUIPMENT_ADD',
      id: 'jmr-2',
      equipment_type: 'barrage_jammer',
      x_m: 4000,
      y_m: 4000,
      eirp_dbm: 65,
    });
    expect(add2.accepted).toBe(true);
    const frameTwoJammers = getLatestFrame();
    expect(frameTwoJammers.tactical_equipment).toHaveLength(2);
    const twoJammerInterfDbm = Math.max(...(frameTwoJammers.jammer_sector_interference_dbm ?? [-150]));
    expect(twoJammerInterfDbm - oneJammerInterfDbm).toBeCloseTo(3.0103, 1);

    const twoJammerNode4Sinr = frameTwoJammers.nodes_telemetry.find((n) => n.node_id === 4)!.snr_db;
    expect(twoJammerNode4Sinr).toBeLessThan(oneJammerNode4Sinr);

    // 3. Add relay_mast and esm_sensor
    expect(
      worker.handleMessage({
        type: 'EQUIPMENT_ADD',
        id: 'rly-1',
        equipment_type: 'relay_mast',
        x_m: -2000,
        y_m: 2500,
        eirp_dbm: 43,
        height_agl_m: 20,
      }).accepted
    ).toBe(true);
    expect(
      worker.handleMessage({
        type: 'EQUIPMENT_ADD',
        id: 'esm-1',
        equipment_type: 'esm_sensor',
        x_m: 1000,
        y_m: -1500,
        sensitivity_dbm: -95,
      }).accepted
    ).toBe(true);

    const withAllFrame = getLatestFrame();
    expect(withAllFrame.tactical_equipment).toHaveLength(4);
    const esmItem = withAllFrame.tactical_equipment?.find((e) => e.id === 'esm-1');
    expect(esmItem).toBeDefined();
    expect(Number.isFinite(esmItem?.intercept_rx_dbm)).toBe(true);
    expect(Number.isFinite(esmItem?.intercept_margin_db)).toBe(true);

    // 4. Toggle & delete & clear restore baseline cleanly
    expect(worker.handleMessage({ type: 'EQUIPMENT_DELETE', id: 'jmr-2' }).accepted).toBe(true);
    expect(worker.handleMessage({ type: 'EQUIPMENT_CLEAR' }).accepted).toBe(true);
    const clearedFrame = getLatestFrame();
    expect(clearedFrame.tactical_equipment).toBeUndefined();
    const restoredNode4Sinr = clearedFrame.nodes_telemetry.find((n) => n.node_id === 4)!.snr_db;
    expect(restoredNode4Sinr).toBeCloseTo(baseNode4Sinr, 0);

    // 5. Manual MCS lock through CONFIG_UPDATE
    const cfgRes = worker.handleMessage({
      type: 'CONFIG_UPDATE',
      params: { mcs_mode: 'manual_lock', manual_modulation: '16-QAM', manual_fec: '3/4' },
    });
    expect(cfgRes.accepted).toBe(true);
    const lockedFrame = getLatestFrame();
    expect(lockedFrame.mcs_mode).toBe('manual_lock');
    expect(lockedFrame.manual_modulation).toBe('16-QAM');
    expect(lockedFrame.manual_fec).toBe('3/4');
  });

  it('enforces simWorker.ts < 3,250 lines, zero @ts-nocheck/@ts-ignore/@ts-expect-error, and strict CSP in index.html', () => {
    const simWorkerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/worker/simWorker.ts'), 'utf8');
    const lineCount = simWorkerSrc.split('\n').length;
    expect(lineCount).toBeLessThan(3250);

    const checkFiles = [
      path.join(ROOT_DIR, 'src/main.ts'),
      path.join(ROOT_DIR, 'src/core/tacticalEquipment.ts'),
      ...collectTsFiles(path.join(ROOT_DIR, 'src/app')),
    ];
    for (const file of checkFiles) {
      const text = fs.readFileSync(file, 'utf8');
      expect(/@ts-nocheck|@ts-ignore|@ts-expect-error/.test(text)).toBe(false);
    }

    const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attrs, body] of scripts) {
      expect(body.trim()).toBe('');
      expect(attrs).toMatch(/\bsrc=/i);
    }
    expect(/\son[a-z]+\s*=/i.test(indexHtml)).toBe(false);
  });
});
