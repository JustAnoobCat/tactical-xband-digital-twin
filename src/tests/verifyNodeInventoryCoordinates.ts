/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Node Inventory Geographic Coordinate Fallback Verification Suite (Phase 1)
 *
 * Validates:
 * 1. Valid worker geodetic coordinates produce verified decimal and DMS strings.
 * 2. Missing latitude (undefined/null) yields an explicit unavailable indicator ('—').
 * 3. Missing longitude (undefined/null) yields an explicit unavailable indicator ('—').
 * 4. Non-finite values (NaN, +Infinity, -Infinity) yield '—'.
 * 5. Non-numeric types (strings, booleans, objects) yield '—'.
 * 6. Out-of-range coordinates (> 90 lat, < -90 lat, > 180 lon, < -180 lon) yield '—'.
 * 7. Local Cartesian coordinates are NEVER used to fabricate geographic coordinates in the UI.
 * 8. Live worker telemetry coordinates match geodesy module and format properly.
 */

import assert from 'node:assert/strict';
import {
  formatNodeGeodeticCoordinates,
  getNodeRole,
} from '../ui/nodeInventory';
import { cartesianToGeodetic } from '../core/geodesy';
import { SimulationWorkerManager } from '../worker/simWorker';

function runNodeInventoryCoordinateVerification(): void {
  console.log('================================================================================');
  console.log('  NODE INVENTORY GEOGRAPHIC COORDINATE FALLBACK VERIFICATION SUITE');
  console.log('================================================================================\n');

  // [1/8] Valid coordinates produce accurate decimal and DMS representations
  console.log('[1/8] Verifying formatting of valid WGS-84 coordinates...');
  {
    const res = formatNodeGeodeticCoordinates(34.50000, 76.50000);
    assert.equal(res.hasValidGeo, true);
    assert.equal(res.latStr, '34.50000°N');
    assert.equal(res.lonStr, '76.50000°E');
    assert.ok(res.latDms.includes('34°30\''));
    assert.ok(res.lonDms.includes('76°30\''));
    assert.equal(res.latDeg, 34.5);
    assert.equal(res.lonDeg, 76.5);

    // Negative coordinates (Southern / Western hemispheres)
    const southWest = formatNodeGeodeticCoordinates(-12.34567, -45.67890);
    assert.equal(southWest.hasValidGeo, true);
    assert.equal(southWest.latStr, '12.34567°S');
    assert.equal(southWest.lonStr, '45.67890°W');
    assert.ok(southWest.latDms.endsWith('S'));
    assert.ok(southWest.lonDms.endsWith('W'));
    console.log('  -> PASS: Valid coordinates format with correct precision, hemisphere, and DMS strings.');
  }

  // [2/8] Missing latitude does not fabricate coordinates
  console.log('\n[2/8] Verifying missing latitude rejection...');
  {
    const resUndef = formatNodeGeodeticCoordinates(undefined, 76.5);
    assert.equal(resUndef.hasValidGeo, false);
    assert.equal(resUndef.latStr, '—');
    assert.equal(resUndef.lonStr, '—');
    assert.equal(resUndef.latDms, 'Unavailable');
    assert.equal(resUndef.lonDms, 'Unavailable');

    const resNull = formatNodeGeodeticCoordinates(null, 76.5);
    assert.equal(resNull.hasValidGeo, false);
    assert.equal(resNull.latStr, '—');
    assert.equal(resNull.lonStr, '—');
    console.log('  -> PASS: Missing latitude does not produce a fabricated coordinate.');
  }

  // [3/8] Missing longitude does not fabricate coordinates
  console.log('\n[3/8] Verifying missing longitude rejection...');
  {
    const resUndef = formatNodeGeodeticCoordinates(34.5, undefined);
    assert.equal(resUndef.hasValidGeo, false);
    assert.equal(resUndef.latStr, '—');
    assert.equal(resUndef.lonStr, '—');

    const resNull = formatNodeGeodeticCoordinates(34.5, null);
    assert.equal(resNull.hasValidGeo, false);
    assert.equal(resNull.latStr, '—');
    assert.equal(resNull.lonStr, '—');
    console.log('  -> PASS: Missing longitude does not produce a fabricated coordinate.');
  }

  // [4/8] Non-finite values (NaN, Infinity) are rejected
  console.log('\n[4/8] Verifying NaN and Infinity rejection...');
  {
    const resNan = formatNodeGeodeticCoordinates(Number.NaN, 76.5);
    assert.equal(resNan.hasValidGeo, false);
    assert.equal(resNan.latStr, '—');

    const resPosInf = formatNodeGeodeticCoordinates(34.5, Number.POSITIVE_INFINITY);
    assert.equal(resPosInf.hasValidGeo, false);
    assert.equal(resPosInf.lonStr, '—');

    const resNegInf = formatNodeGeodeticCoordinates(Number.NEGATIVE_INFINITY, 76.5);
    assert.equal(resNegInf.hasValidGeo, false);
    assert.equal(resNegInf.latStr, '—');
    console.log('  -> PASS: Non-finite numeric values cleanly resolve to unavailable state.');
  }

  // [5/8] Non-numeric types are rejected
  console.log('\n[5/8] Verifying non-numeric type safety...');
  {
    const resStr = formatNodeGeodeticCoordinates('34.5' as any, '76.5' as any);
    assert.equal(resStr.hasValidGeo, false);
    assert.equal(resStr.latStr, '—');
    assert.equal(resStr.lonStr, '—');

    const resObj = formatNodeGeodeticCoordinates({ lat: 34.5 } as any, [76.5] as any);
    assert.equal(resObj.hasValidGeo, false);
    assert.equal(resObj.latStr, '—');

    const resBool = formatNodeGeodeticCoordinates(true as any, false as any);
    assert.equal(resBool.hasValidGeo, false);
    console.log('  -> PASS: Non-numeric values safely rejected.');
  }

  // [6/8] Out-of-bounds latitude/longitude rejected
  console.log('\n[6/8] Verifying geodetic range boundary enforcement...');
  {
    const latOver = formatNodeGeodeticCoordinates(90.001, 76.5);
    assert.equal(latOver.hasValidGeo, false);
    assert.equal(latOver.latStr, '—');

    const latUnder = formatNodeGeodeticCoordinates(-90.001, 76.5);
    assert.equal(latUnder.hasValidGeo, false);
    assert.equal(latUnder.latStr, '—');

    const lonOver = formatNodeGeodeticCoordinates(34.5, 180.001);
    assert.equal(lonOver.hasValidGeo, false);
    assert.equal(lonOver.lonStr, '—');

    const lonUnder = formatNodeGeodeticCoordinates(34.5, -180.001);
    assert.equal(lonUnder.hasValidGeo, false);
    assert.equal(lonUnder.lonStr, '—');
    console.log('  -> PASS: Geographic coordinates outside [-90, 90] lat and [-180, 180] lon rejected.');
  }

  // [7/8] Local Cartesian coordinates are NOT used as fallback
  console.log('\n[7/8] Verifying local Cartesian coordinates do NOT fabricate geographic coordinates...');
  {
    // A node with Cartesian coordinates x_m = 15000, y_m = -20000, but lat_deg and lon_deg undefined
    const mockNode: any = {
      node_id: 2,
      x_m: 15000.0,
      y_m: -20000.0,
      lat_deg: undefined,
      lon_deg: undefined,
    };

    const formatted = formatNodeGeodeticCoordinates(mockNode.lat_deg, mockNode.lon_deg);
    assert.equal(formatted.hasValidGeo, false);
    assert.equal(formatted.latStr, '—', 'Latitude must be — when telemetry lacks lat_deg');
    assert.equal(formatted.lonStr, '—', 'Longitude must be — when telemetry lacks lon_deg');
    // Ensure it does not equal the old erroneous fallback (34.5 + (-20000)/110931.4506 = 34.31971)
    assert.notEqual(formatted.latStr, '34.31971°N');
    console.log('  -> PASS: UI no longer silently interprets local Cartesian X/Y as geodetic coordinates.');
  }

  // [8/8] Integration with authoritative simulation worker telemetry
  console.log('\n[8/8] Verifying integration with simulation worker telemetry...');
  {
    const worker = new SimulationWorkerManager();
    const nodes = worker.buildNodesTelemetry();
    assert.equal(nodes.length, 16, 'Expected 16 registered ground nodes in worker telemetry');

    for (const node of nodes) {
      assert(Number.isFinite(node.lat_deg), `Node ${node.node_id} must have finite lat_deg`);
      assert(Number.isFinite(node.lon_deg), `Node ${node.node_id} must have finite lon_deg`);

      const expectedGeo = cartesianToGeodetic(node.x_m, node.y_m);
      assert.ok(Math.abs(node.lat_deg - expectedGeo.latDeg) < 1e-12, `Node ${node.node_id} lat_deg matches geodesy`);
      assert.ok(Math.abs(node.lon_deg - expectedGeo.lonDeg) < 1e-12, `Node ${node.node_id} lon_deg matches geodesy`);

      const formatted = formatNodeGeodeticCoordinates(node.lat_deg, node.lon_deg);
      assert.equal(formatted.hasValidGeo, true);
      assert.ok(formatted.latStr.endsWith('°N') || formatted.latStr.endsWith('°S'));
      assert.ok(formatted.lonStr.endsWith('°E') || formatted.lonStr.endsWith('°W'));
      assert.notEqual(formatted.latDms, 'Unavailable');
      assert.notEqual(formatted.lonDms, 'Unavailable');

      const role = getNodeRole(node.node_id);
      assert.ok(role.length > 0, `Role for node ${node.node_id} must be present`);
    }
    console.log('  -> PASS: All 16 worker nodes emit valid geodetic coordinates matching geodesy module.');
  }

  console.log('\n================================================================================');
  console.log('  ALL 8 NODE INVENTORY GEODETIC COORDINATE VERIFICATION TESTS PASSED!');
  console.log('================================================================================');
}

runNodeInventoryCoordinateVerification();

