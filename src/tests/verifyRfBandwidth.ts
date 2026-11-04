import assert from 'node:assert/strict';
import { RFConfig, EnvironmentConfig } from '../core/config';
import { LinkBudgetEngine } from '../core/linkBudget';
import { SimulationWorkerManager } from '../worker/simWorker';

function close(actual: number, expected: number, tolerance = 1e-3, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('================================================================================');
console.log('  CONFIGURABLE RF CHANNEL BANDWIDTH & NOISE RECALCULATION SUITE');
console.log('================================================================================\n');

// -------------------------------------------------------------------------------------------------
// [1/6] Bandwidth parameter validation
// -------------------------------------------------------------------------------------------------
console.log('[1/6] Verifying channel bandwidth input validation...');
{
  const sim = new SimulationWorkerManager();

  // Valid bandwidths in [0.1, 50.0] MHz
  for (const validBw of [0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0]) {
    const res = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { channel_bandwidth_mhz: validBw } });
    assert.equal(res.accepted, true, `Bandwidth ${validBw} MHz must be accepted`);
  }

  // Invalid bandwidths: <= 0, > 50, NaN, Infinity, negative
  for (const badBw of [0, -1, 0.05, 50.1, 100, Number.NaN, Infinity, '10MHz']) {
    const res = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { channel_bandwidth_mhz: badBw as any } });
    assert.equal(res.accepted, false, `Invalid bandwidth ${badBw} must be rejected`);
  }

  console.log('  -> PASS: Bandwidth range [0.1, 50.0] MHz strictly enforced.');
}

// -------------------------------------------------------------------------------------------------
// [2/6] Thermal noise floor recalculation: P_noise = 10 * log10(k * T * B) + NF
// -------------------------------------------------------------------------------------------------
console.log('[2/6] Verifying thermal noise floor recalculation with channel bandwidth...');
{
  const k = 1.380649e-23;
  const T = 290.0;
  const nfDb = 5.0; // ACN noise figure

  for (const bwMhz of [0.5, 1.0, 2.0, 5.0, 10.0]) {
    const bwHz = bwMhz * 1e6;
    const { pNoiseDbm } = LinkBudgetEngine.computeThermalNoiseFloorDbm(bwHz, nfDb, T, k);
    
    // Theoretical: 10 * log10(k * T * B) + 30 (for dBm) + NF
    const expectedDbm = 10 * Math.log10(k * T * bwHz) + 30 + nfDb;
    close(pNoiseDbm, expectedDbm, 1e-4, `Thermal noise floor for ${bwMhz} MHz`);
  }

  // Doubling bandwidth from 1.0 MHz to 2.0 MHz must increase noise floor by 10 * log10(2) ~ 3.0103 dB
  const { pNoiseDbm: p1 } = LinkBudgetEngine.computeThermalNoiseFloorDbm(1.0e6, nfDb, T, k);
  const { pNoiseDbm: p2 } = LinkBudgetEngine.computeThermalNoiseFloorDbm(2.0e6, nfDb, T, k);
  close(p2 - p1, 10 * Math.log10(2), 1e-4, 'Doubling bandwidth adds ~3.01 dB to noise floor');

  console.log('  -> PASS: Thermal noise floor mathematically conforms to P_noise = 10*log10(kTB) + NF.');
}

// -------------------------------------------------------------------------------------------------
// [3/6] SNR degradation under wider bandwidth with identical path loss
// -------------------------------------------------------------------------------------------------
console.log('[3/6] Verifying SNR response across bandwidth settings...');
{
  const engine = new LinkBudgetEngine();
  const env = new EnvironmentConfig();
  const slantM = 15000.0;

  const rf1 = new RFConfig({ channelBandwidthHz: 1.0e6 });
  const rf2 = new RFConfig({ channelBandwidthHz: 4.0e6 });

  const lb1 = engine.evaluateLink('soldier', slantM, 0, rf1, env, false);
  const lb2 = engine.evaluateLink('soldier', slantM, 0, rf2, env, false);

  // 4x bandwidth adds 10 * log10(4) ~ 6.02 dB of noise, thus SNR drops by ~6.02 dB
  const snrDelta = lb1.snrDb - lb2.snrDb;
  close(snrDelta, 10 * Math.log10(4), 1e-3, '4x bandwidth lowers SNR by ~6.02 dB');

  console.log('  -> PASS: Wider bandwidth increases noise floor and lowers link SNR.');
}

// -------------------------------------------------------------------------------------------------
// [4/6] Data rate scaling: Bitrate = SpectralEfficiency * Bandwidth
// -------------------------------------------------------------------------------------------------
console.log('[4/6] Verifying achievable bitrate scaling with channel bandwidth...');
{
  const engine = new LinkBudgetEngine();
  const env = new EnvironmentConfig();
  // Short distance (2 km) guarantees high SNR and highest MODCOD (e.g. 64-APSK 5/6)
  const slantM = 2000.0;

  const rf1 = new RFConfig({ channelBandwidthHz: 1.0e6 });
  const rf2 = new RFConfig({ channelBandwidthHz: 2.0e6 });

  const lb1 = engine.evaluateLink('soldier', slantM, 0, rf1, env, false);
  const lb2 = engine.evaluateLink('soldier', slantM, 0, rf2, env, false);

  // If both achieve the same MODCOD:
  if (lb1.modcodName === lb2.modcodName) {
    close(lb2.bitrateBps / lb1.bitrateBps, 2.0, 1e-4, 'Bitrate scales linearly with bandwidth for identical MODCOD');
  } else {
    // If MODCOD changed due to noise floor, bitrate still equals eta * B
    close(lb1.bitrateBps, lb1.spectralEfficiency * 1.0e6, 1e-3);
    close(lb2.bitrateBps, lb2.spectralEfficiency * 2.0e6, 1e-3);
  }

  console.log('  -> PASS: Bitrate strictly obeys R = eta * B.');
}

// -------------------------------------------------------------------------------------------------
// [5/6] Worker authoritative integration and immediate telemetry reflection
// -------------------------------------------------------------------------------------------------
console.log('[5/6] Verifying worker integration, profile emission, and link budget telemetry...');
{
  const sim = new SimulationWorkerManager();
  
  // Set bandwidth to 2.5 MHz
  const updateRes = sim.handleMessage({ type: 'CONFIG_UPDATE', params: { channel_bandwidth_mhz: 2.5 } });
  assert.equal(updateRes.accepted, true);

  // Authoritative worker rfConfig must reflect 2.5 MHz (2.5e6 Hz)
  assert.equal(sim.rfConfig.channelBandwidthHz, 2.5e6);

  // Telemetry frame selected_link_budget must reflect channel_bandwidth_hz
  const frame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
  assert.equal(frame.selected_link_budget.channel_bandwidth_hz, 2.5e6);

  // Check noise floor in selected_link_budget matches 2.5 MHz
  const expectedNoise = 10 * Math.log10(sim.rfConfig.boltzmannConstant * sim.envConfig.atmosphericTemperatureK * 2.5e6) + 30 + sim.rfConfig.acnNoiseFigureDb;
  close(frame.selected_link_budget.pnoise_dbm, expectedNoise, 1e-2, 'Telemetry pnoise_dbm reflects 2.5 MHz');

  console.log('  -> PASS: Worker authoritative telemetry reflects updated bandwidth and noise floor.');
}

// -------------------------------------------------------------------------------------------------
// [6/6] Outage protection under bandwidth-induced noise floor rise
// -------------------------------------------------------------------------------------------------
console.log('[6/6] Verifying graceful degradation and outage detection under high noise...');
{
  const engine = new LinkBudgetEngine();
  const env = new EnvironmentConfig();
  const slantM = 35000.0; // Marginal link distance (35 km)

  const rfNarrow = new RFConfig({ channelBandwidthHz: 0.5e6 });
  const rfWide = new RFConfig({ channelBandwidthHz: 20.0e6 });

  const lbNarrow = engine.evaluateLink('soldier', slantM, 0, rfNarrow, env, false);
  const lbWide = engine.evaluateLink('soldier', slantM, 0, rfWide, env, false);

  // Wider bandwidth lowers SNR by 10 * log10(20 / 0.5) = 16.02 dB
  assert.ok(lbNarrow.snrDb > lbWide.snrDb, 'Narrow bandwidth provides higher SNR in power-limited regime');
  if (lbWide.isOutage) {
    assert.equal(lbWide.bitrateBps, 0.0, 'Outage link bitrate must be 0 bps');
    assert.equal(lbWide.modcodName, 'LINK_OUTAGE');
  }

  console.log('  -> PASS: Link budget correctly identifies capacity vs power-limited trade-offs.');
}

console.log('\n================================================================================');
console.log('  ALL 6 RF CHANNEL BANDWIDTH & NOISE RECALCULATION SUITES PASSED CLEANLY!');
console.log('================================================================================\n');
