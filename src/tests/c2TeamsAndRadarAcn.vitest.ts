import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  drawRadar2D,
  worldEnuToRadarCanvas,
} from '../ui/controllers/radar2dRenderer';
import {
  shouldShowMapNodePopover,
} from '../app/radar2dAndInteractionController';
import {
  clampTimelineDockHeight,
} from '../app/scientificScopesAndTimelineController';
import { SimulationWorkerManager } from '../worker/simWorker';
import { EdgeAiCopilotCoordinator } from '../worker/aiCopilotCoordinator';
import {
  AI_LINK_BUDGET_CONSTANTS,
  EdgeAiQTable,
  computeAiLpiStealthPower,
  evaluateFastLinkSinr,
} from '../core/tacticalAiPathfinder';
import {
  NetworkPerformanceHistory,
  aggregateTeamNetworkSample,
} from '../ui/networkPerformanceDashboard';
import { NetworkTrafficTracker } from '../ui/networkTrafficInventory';
import { evaluateTeam5QiBearerSlaMetrics } from '../core/qosSlaEngine';
import type { TelemetryFrame } from '../shared/workerProtocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

function createMockRadarCanvasContext() {
  const moveTos: Array<{ x: number; y: number }> = [];
  const lineTos: Array<{ x: number; y: number }> = [];
  const arcs: Array<{ x: number; y: number; r: number }> = [];
  const lineDashes: number[][] = [];
  const texts: Array<{ text: string; x: number; y: number }> = [];

  const ctx: any = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    font: '10px monospace',
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    arc: (x: number, y: number, r: number) => {
      arcs.push({ x, y, r });
    },
    moveTo: (x: number, y: number) => {
      moveTos.push({ x, y });
    },
    lineTo: (x: number, y: number) => {
      lineTos.push({ x, y });
    },
    setLineDash: (d: number[]) => {
      lineDashes.push([...d]);
    },
    measureText: (t: string) => ({ width: t.length * 6.5 }),
    fillText: (text: string, x: number, y: number) => {
      texts.push({ text, x, y });
    },
    createRadialGradient: () => ({
      addColorStop: () => {},
    }),
  };

  return { ctx, moveTos, lineTos, arcs, lineDashes, texts };
}

describe('C2-TEAMS-AND-UX-01: 2D Radar Elliptical ACN, Non-Blocking Popover, Rename/Edit, Teams & Timeline Stretch', () => {
  it('T1: draws ACN and 4-sector origin at projected (7500, 3200) ENU in ELLIPTICAL mode, NOT canvas center', () => {
    const { ctx, moveTos, arcs, lineDashes, texts } = createMockRadarCanvasContext();
    const width = 800;
    const height = 600;
    const rangeM = 60000;

    drawRadar2D(ctx, {
      width,
      height,
      rangeM,
      panOffsetX_m: 0,
      panOffsetY_m: 0,
      flightTrajectoryMode: 'ELLIPTICAL',
      acnPositionEnu: [7500, 3200, 5000],
      telemetry: {
        sim_time_s: 12.5,
        trajectory_config: {
          trajectory_mode: 'ellipse',
          center_x_m: 0,
          center_y_m: 0,
          orbit_a_m: 20000,
          orbit_b_m: 10000,
          orbit_rotation_deg: 35,
        },
        nodes_telemetry: [
          {
            node_id: 4,
            name: 'Recon-4',
            team_id: 'charlie',
            team_name: 'Charlie Recon',
            x_m: 12000,
            y_m: 8000,
            snr_db: 14.5,
            terrain_is_los: true,
            link_outage: false,
          },
        ],
      },
    });

    const expectedAcnPt = worldEnuToRadarCanvas(7500, 3200, {
      width,
      height,
      rangeM,
      panOffsetX_m: 0,
      panOffsetY_m: 0,
    });
    const centerPt = { x: width / 2, y: height / 2 };
    expect(Math.hypot(expectedAcnPt.x - centerPt.x, expectedAcnPt.y - centerPt.y)).toBeGreaterThan(20);

    // Sector arcs & ACN triangle vertex must anchor at expectedAcnPt, not canvas center
    const acnSectorArc = arcs.find(
      (a) => Math.abs(a.x - expectedAcnPt.x) < 0.01 && Math.abs(a.y - expectedAcnPt.y) < 0.01
    );
    expect(acnSectorArc).toBeDefined();

    const acnTriangleApex = moveTos.find(
      (m) => Math.abs(m.x - expectedAcnPt.x) < 0.01 && Math.abs(m.y - (expectedAcnPt.y - 9)) < 0.01
    );
    expect(acnTriangleApex).toBeDefined();

    const centerTriangleApex = moveTos.find(
      (m) => Math.abs(m.x - centerPt.x) < 0.01 && Math.abs(m.y - (centerPt.y - 9)) < 0.01
    );
    expect(centerTriangleApex).toBeUndefined();

    // Dashed elliptical orbit track drawn
    expect(lineDashes.some((d) => d.length === 2 && d[0] === 6 && d[1] === 4)).toBe(true);
    // Node callout includes Team badge
    expect(texts.some((t) => t.text.includes('Recon-4') && t.text.includes('[Charlie]'))).toBe(true);
  });

  it('T2: enforces non-blocking drag & locked-only popover policy and propagates NODE_UPDATE + TEAM_ASSIGN in worker', () => {
    // 1. Popover visibility policy checks
    expect(
      shouldShowMapNodePopover({
        hasSelection: true,
        dismissed: false,
        spatialLocked: false,
        isDragging: false,
        lockedOnlyMode: true,
      })
    ).toBe(false);
    expect(
      shouldShowMapNodePopover({
        hasSelection: true,
        dismissed: false,
        spatialLocked: true,
        isDragging: false,
        lockedOnlyMode: true,
      })
    ).toBe(true);
    expect(
      shouldShowMapNodePopover({
        hasSelection: true,
        dismissed: false,
        spatialLocked: false,
        isDragging: true,
        lockedOnlyMode: false,
      })
    ).toBe(false);

    // 2. Real SimulationWorkerManager NODE_UPDATE & TEAM_ASSIGN
    const sim = new SimulationWorkerManager(0, '16_NODES');
    const captured: TelemetryFrame[] = [];
    (sim as any).emitHostMessage = (msg: any) => {
      if (msg?.type === 'TELEMETRY_FRAME' && msg.frame) {
        captured.push(msg.frame as TelemetryFrame);
      }
    };

    const upd = sim.handleMessage({
      type: 'NODE_UPDATE',
      node_id: 4,
      callsign: 'HAWK-4',
      role: 'convoy',
      team_id: 'delta',
      team_name: 'Delta Team',
      tx_power_dbm: 41.5,
      agl_m: 6.5,
    });
    expect(upd.accepted).toBe(true);

    const assign = sim.handleMessage({
      type: 'TEAM_ASSIGN',
      node_ids: [5, 6],
      team_id: 'delta',
      team_name: 'Delta Team',
    });
    expect(assign.accepted).toBe(true);

    sim.tickSimulation(true);
    const frame = captured[captured.length - 1];
    expect(frame).toBeDefined();

    const n4 = frame.nodes_telemetry.find((n) => n.node_id === 4)!;
    expect(n4.label).toBe('HAWK-4');
    expect(n4.name).toBe('HAWK-4');
    expect(n4.node_role).toBe('convoy');
    expect(n4.team_id).toBe('delta');
    expect(n4.team_name).toBe('Delta Team');
    expect(n4.tx_power_dbm).toBeCloseTo(41.5, 4);
    expect(n4.antenna_height_agl_m).toBeCloseTo(6.5, 4);

    const n5 = frame.nodes_telemetry.find((n) => n.node_id === 5)!;
    const n6 = frame.nodes_telemetry.find((n) => n.node_id === 6)!;
    expect(n5.team_id).toBe('delta');
    expect(n5.team_name).toBe('Delta Team');
    expect(n6.team_id).toBe('delta');
    expect(n6.team_name).toBe('Delta Team');
  });

  it('T3: aggregates NetworkPerformanceHistory, NetworkTrafficTracker & 5QI SLA for team:delta', () => {
    const perfHistory = new NetworkPerformanceHistory(60, 1);
    const trafficTracker = new NetworkTrafficTracker();

    const nodesFrame1 = [
      {
        node_id: 1,
        name: 'Alpha-1',
        team_id: 'alpha',
        team_name: 'Alpha Squad',
        snr_db: 20,
        sinr_db: 19,
        link_outage: false,
        terrain_is_los: true,
        is_transmitting: true,
        c2_backlog: 1,
        voice_backlog: 2,
        video_backlog: 0,
        photo_backlog: 0,
        c2_bytes: 128,
        voice_bytes: 640,
        video_bytes: 0,
        photo_bytes: 0,
        transfer_state: { current_rate_bps: 1_000_000, current_rate_mbps: 1.0, delivered_bytes: 50_000, status: 'TRANSMITTING' },
      },
      {
        node_id: 4,
        name: 'Delta-4',
        team_id: 'delta',
        team_name: 'Delta Team',
        snr_db: 15,
        sinr_db: 14,
        link_outage: false,
        terrain_is_los: true,
        is_transmitting: true,
        c2_backlog: 2,
        voice_backlog: 3,
        video_backlog: 4,
        photo_backlog: 1,
        c2_bytes: 256,
        voice_bytes: 960,
        video_bytes: 4800,
        photo_bytes: 1400,
        transfer_state: { current_rate_bps: 2_500_000, current_rate_mbps: 2.5, delivered_bytes: 125_000, status: 'TRANSMITTING' },
      },
      {
        node_id: 5,
        name: 'Delta-5',
        team_id: 'delta',
        team_name: 'Delta Team',
        snr_db: 19,
        sinr_db: 18,
        link_outage: false,
        terrain_is_los: true,
        is_transmitting: true,
        c2_backlog: 1,
        voice_backlog: 1,
        video_backlog: 2,
        photo_backlog: 3,
        c2_bytes: 128,
        voice_bytes: 320,
        video_bytes: 2400,
        photo_bytes: 4200,
        transfer_state: { current_rate_bps: 1_500_000, current_rate_mbps: 1.5, delivered_bytes: 75_000, status: 'TRANSMITTING' },
      },
    ];

    const sample = perfHistory.ingest({
      frameIndex: 1,
      simulationTimeS: 1.0,
      nodes: nodesFrame1,
    })!;
    expect(sample).not.toBeNull();

    const teamAgg = aggregateTeamNetworkSample(sample, 'team:delta');
    expect(teamAgg.teamId).toBe('delta');
    expect(teamAgg.teamName).toBe('Delta Team');
    expect(teamAgg.memberCount).toBe(2);
    expect(teamAgg.activeMemberCount).toBe(2);
    expect(teamAgg.outageMemberCount).toBe(0);
    expect(teamAgg.totalRateMbps).toBeCloseTo(4.0, 6);
    expect(teamAgg.totalTransferredMb).toBeCloseTo(((125_000 + 75_000) * 8) / 1e6, 6);
    expect(teamAgg.averageSinrDb).toBeCloseTo(16.0, 6);

    const series = perfHistory.getTeamSeries('team:delta');
    expect(series.length).toBe(1);
    expect(series[0].totalRateMbps).toBeCloseTo(4.0, 6);

    const trafficFrame = { frameIndex: 1, simulationTimeS: 1.0, nodes: nodesFrame1 };
    trafficTracker.ingest(trafficFrame);
    const teamTraffic = trafficTracker.getTeamSummary('team:delta', trafficFrame)!;
    expect(teamTraffic).not.toBeNull();
    expect(teamTraffic.memberCount).toBe(2);
    expect(teamTraffic.currentUploadRateMbps).toBeCloseTo(4.0, 6);
    expect(teamTraffic.c2Packets).toBe(3);
    expect(teamTraffic.voicePackets).toBe(4);
    expect(teamTraffic.videoPackets).toBe(6);
    expect(teamTraffic.photoPackets).toBe(4);
    expect(teamTraffic.c2Bytes).toBe(384);
    expect(teamTraffic.voiceBytes).toBe(1280);
    expect(teamTraffic.videoBytes).toBe(7200);
    expect(teamTraffic.photoBytes).toBe(5600);

    const slaReport = evaluateTeam5QiBearerSlaMetrics(nodesFrame1, 'team:delta');
    expect(slaReport.bearers.find((b) => b.qos5qi === 69)?.backlogBits).toBe(384 * 8);
    expect(slaReport.bearers.find((b) => b.qos5qi === 70)?.backlogBits).toBe(5600 * 8);
  });

  it('T5: timeline vertical stretch clamp allows stretching >= 80% of viewport height', () => {
    const viewportH = 900;
    const maxAllowed = clampTimelineDockHeight(2000, viewportH);
    expect(maxAllowed).toBe(viewportH - 96);
    expect(maxAllowed / viewportH).toBeGreaterThanOrEqual(0.8);
    expect(clampTimelineDockHeight(40, viewportH)).toBe(96);
  });

  it('T4: enforces strict TS, strict CSP in index.html, and simWorker.ts < 3,250 lines', () => {
    const appFiles = readdirSync(path.join(ROOT_DIR, 'src', 'app'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(ROOT_DIR, 'src', 'app', f));
    for (const file of [path.join(ROOT_DIR, 'src', 'main.ts'), ...appFiles]) {
      const content = readFileSync(file, 'utf8');
      expect(/@ts-(nocheck|ignore|expect-error)/.test(content)).toBe(false);
    }

    const html = readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    expect(/\son[a-z]+\s*=/i.test(html)).toBe(false);
    const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const m of scriptTags) {
      const attrs = m[1] || '';
      const body = (m[2] || '').trim();
      if (!/\bsrc\s*=/i.test(attrs)) {
        expect(body).toBe('');
      }
    }

    const simWorkerLines = readFileSync(path.join(ROOT_DIR, 'src', 'worker', 'simWorker.ts'), 'utf8').split('\n').length;
    expect(simWorkerLines).toBeLessThan(3250);
  });

  it('T6: FIX-CONVOY-01 — NODE_UPDATE with role="convoy" runs 10 ticks on real SimulationWorkerManager without throwing and reports valid link budget', () => {
    const sim = new SimulationWorkerManager(0, '16_NODES');
    const captured: TelemetryFrame[] = [];
    (sim as any).emitHostMessage = (msg: any) => {
      if (msg?.type === 'TELEMETRY_FRAME' && msg.frame) {
        captured.push(msg.frame as TelemetryFrame);
      }
    };

    const upd = sim.handleMessage({
      type: 'NODE_UPDATE',
      node_id: 2,
      role: 'convoy',
    });
    expect(upd.accepted).toBe(true);

    expect(() => {
      for (let i = 0; i < 10; i++) {
        sim.tickSimulation(true);
      }
    }).not.toThrow();

    expect(captured.length).toBe(10);
    const lastFrame = captured[captured.length - 1];
    const convoyNode = lastFrame.nodes_telemetry.find((n) => n.node_id === 2);
    expect(convoyNode).toBeDefined();
    expect(convoyNode!.node_role).toBe('convoy');
    expect(Number.isFinite(convoyNode!.tx_power_dbm)).toBe(true);
    expect(convoyNode!.tx_power_dbm).toBeGreaterThan(0);
    expect(Number.isFinite(convoyNode!.snr_db)).toBe(true);
    expect(Number.isFinite(convoyNode!.bitrate_mbps)).toBe(true);
    expect(convoyNode!.bitrate_mbps).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(convoyNode!.slant_range_km)).toBe(true);
    expect(convoyNode!.slant_range_km).toBeGreaterThanOrEqual(0);
    expect(typeof convoyNode!.modcod_name).toBe('string');
    expect(convoyNode!.modcod_name.length).toBeGreaterThan(0);
  });

  it('T7: FIX-EDGEAI-01 — EdgeAiQTable non-aliasing for nodeId >= 16, 5 MHz vs 1 MHz SINR scaling & MODCOD-aware LPI margin', () => {
    // 1. EdgeAiQTable preserves 1 KB Float32Array(256) and avoids nodeId=16 aliasing nodeId=0
    const qTable = new EdgeAiQTable();
    expect(qTable.qTable.length).toBe(256);
    expect(qTable.qTable.byteLength).toBe(1024);

    const q0 = qTable.updateQValue(0, 3, 12.0, 0.25);
    const q16 = qTable.updateQValue(16, 3, 28.0, 0.25);
    const qNeg = qTable.updateQValue(-1, 3, 20.0, 0.25);
    expect(q0).toBeCloseTo(3.0, 6);
    expect(q16).toBeCloseTo(7.0, 6);
    expect(qNeg).toBeCloseTo(5.0, 6);
    expect(qTable.getQValue(0, 3)).toBeCloseTo(3.0, 6);
    expect(qTable.getQValue(16, 3)).toBeCloseTo(7.0, 6);
    expect(qTable.getQValue(-1, 3)).toBeCloseTo(5.0, 6);
    qTable.reset();
    expect(qTable.getQValue(0, 3)).toBe(0);
    expect(qTable.getQValue(16, 3)).toBe(0);
    expect(qTable.getQValue(-1, 3)).toBe(0);

    // 2. Canonical 5.0 MHz alignment & 5 MHz vs 1 MHz thermal noise scaling (~6.99 dB)
    expect(AI_LINK_BUDGET_CONSTANTS.channelBandwidthHz).toBe(5.0e6);
    expect(AI_LINK_BUDGET_CONSTANTS.noisePowerDbm).toBeCloseTo(-101.99, 2);
    expect(AI_LINK_BUDGET_CONSTANTS.cableLossDb + AI_LINK_BUDGET_CONSTANTS.implMarginDb).toBeCloseTo(5.0, 6);

    const flatElev = () => 3000.0;
    const nodePos: [number, number, number] = [0, 0, 3002];
    const acnPos: [number, number, number] = [0, 20000, 5000];
    const resDefault = evaluateFastLinkSinr(nodePos, acnPos, flatElev);
    const res5MHz = evaluateFastLinkSinr(
      nodePos,
      acnPos,
      flatElev,
      AI_LINK_BUDGET_CONSTANTS.txPowerDbm,
      AI_LINK_BUDGET_CONSTANTS.txGainDbi,
      AI_LINK_BUDGET_CONSTANTS.rxGainDbi,
      undefined,
      10,
      5.0e6
    );
    const res1MHz = evaluateFastLinkSinr(
      nodePos,
      acnPos,
      flatElev,
      AI_LINK_BUDGET_CONSTANTS.txPowerDbm,
      AI_LINK_BUDGET_CONSTANTS.txGainDbi,
      AI_LINK_BUDGET_CONSTANTS.rxGainDbi,
      undefined,
      10,
      1.0e6
    );
    expect(resDefault.sinrDb).toBeCloseTo(res5MHz.sinrDb, 6);
    expect(res1MHz.sinrDb - res5MHz.sinrDb).toBeCloseTo(10 * Math.log10(5.0), 2);

    // 3. MODCOD-aware LPI margin protection while keeping computeAiLpiStealthPower default 18.5 dB
    const directLpi = computeAiLpiStealthPower(30.0, 30.0, false);
    expect(directLpi.lpiTxPowerDbm).toBeCloseTo(18.5, 4);

    const coordinator = new EdgeAiCopilotCoordinator();
    // At 26 dB SINR, active MODCOD is 64-APSK 5/6 (minSnrDb = 22.0 dB) -> target = 24.5 dB
    const lpi64Apsk = coordinator.evaluateLpiStealth(36.0, 26.0, false, 18.5);
    expect(lpi64Apsk.mode).toBe('LPI_STEALTH_THROTTLED');
    expect(lpi64Apsk.reductionDb).toBeCloseTo(1.5, 4);
    expect(lpi64Apsk.lpiTxPowerDbm).toBeCloseTo(34.5, 4);

    // At 19.5 dB SINR, active MODCOD is 32-APSK 3/4 (minSnrDb = 17.5 dB) -> target = 20.0 dB > 19.5 dB
    const lpi32Apsk = coordinator.evaluateLpiStealth(36.0, 19.5, false, 18.5);
    expect(lpi32Apsk.mode).toBe('MAX_BOOST_DIFFRACTION');
    expect(lpi32Apsk.reductionDb).toBe(0);
    expect(lpi32Apsk.lpiTxPowerDbm).toBe(36.0);
  });
});
