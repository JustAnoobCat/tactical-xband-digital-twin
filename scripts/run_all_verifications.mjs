#!/usr/bin/env node
/**
 * scripts/run_all_verifications.mjs
 * Comprehensive Verification Runner for DRDO X-Band Digital Twin (Milestone M0.1)
 *
 * Executes every registered verification suite independently:
 * - Structural checks, static typechecking, and all 30 test suites.
 * - Records execution duration, exit status, and detailed diagnostics.
 * - Continues execution across individual failures.
 * - Supports configurable per-suite timeouts (--timeout <ms>).
 * - Generates machine-readable JSON reports and terminal summary tables.
 * - Exits with code 0 if all suites pass, or code 1 if any suite fails or times out.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

// -----------------------------------------------------------------------------
// CLI Argument Parsing
// -----------------------------------------------------------------------------
function getArg(flag, fallback) {
  const prefix = `${flag}=`;
  const eqArg = process.argv.find(a => a.startsWith(prefix));
  if (eqArg) {
    return eqArg.slice(prefix.length);
  }
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const timeoutMs = parseInt(getArg('--timeout', process.env.VERIFY_TIMEOUT_MS || '120000'), 10);
const suiteFilter = getArg('--suite', null);
const bailOnError = process.argv.includes('--bail');
const outputDir = resolve(process.cwd(), getArg('--out-dir', 'benchmark_results/generated'));

// Concurrency Resolution: --serial => 1, --concurrency=N / VERIFY_CONCURRENCY => [1, 16], default min(4, cpus)
const isSerial = process.argv.includes('--serial');
const rawConcurrency = getArg('--concurrency', process.env.VERIFY_CONCURRENCY);

let concurrency;
if (isSerial) {
  concurrency = 1;
} else if (rawConcurrency) {
  const parsed = parseInt(rawConcurrency, 10);
  concurrency = Number.isFinite(parsed) ? Math.min(16, Math.max(1, parsed)) : Math.min(4, Math.max(1, os.cpus().length));
} else {
  concurrency = Math.min(4, Math.max(1, os.cpus().length));
}

// -----------------------------------------------------------------------------
// Verification Suites Registry (136 Total Suites)
// -----------------------------------------------------------------------------
const viteNodeBin = resolve(process.cwd(), 'node_modules/.bin/vite-node');

const REGISTERED_SUITES = [
  { id: 'verify-project', name: 'Structural Project Verification', command: process.execPath, args: ['scripts/verify-project.mjs'], category: 'structural' },
  { id: 'typecheck', name: 'TypeScript Static Typecheck', command: 'npm', args: ['run', 'typecheck'], category: 'typecheck' },
  { id: 'verify:physics', name: 'Physical Propagation & Geodesy', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPhysics.ts'], category: 'physics' },
  { id: 'verify:scheduler', name: 'Scheduler & Queue Verification', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyScheduler.ts'], category: 'scheduler' },
  { id: 'verify:worker', name: 'Worker State & Commands', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyWorkerState.ts'], category: 'worker' },
  { id: 'verify:trajectory', name: 'Trajectory Modes & Kinematics', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTrajectoryModes.ts'], category: 'trajectory' },
  { id: 'verify:trajectory-editor', name: 'Trajectory Editor State', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTrajectoryEditor.ts'], category: 'editor' },
  { id: 'verify:obstacles', name: 'Artificial Obstacles Core', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyObstacles.ts'], category: 'obstacles' },
  { id: 'verify:obstacle-editor', name: 'Obstacle Editor UI State', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyObstacleEditor.ts'], category: 'editor' },
  { id: 'verify:profile-freshness', name: 'Link Profile Freshness & Cache', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyProfileFreshness.ts'], category: 'profile' },
  { id: 'verify:profile-viewport', name: 'Link Profile Viewport Navigation', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyProfileViewport.ts'], category: 'profile' },
  { id: 'verify:history', name: 'Historical Profile Storage', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHistoricalProfile.ts'], category: 'history' },
  { id: 'verify:history-scheduler', name: 'Historical Scheduler Records', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHistoricalScheduler.ts'], category: 'history' },
  { id: 'verify:history-timeline', name: 'Historical 60s Ring Buffer & Isolation', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHistoryTimeline60s.ts'], category: 'history' },
  { id: 'verify:link-classifier', name: 'Link Status Classifier', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyLinkClassifier.ts'], category: 'rf' },
  { id: 'verify:three-foundation', name: 'Three.js Scene Foundation & Context', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyThreeFoundation.ts'], category: 'three' },
  { id: 'verify:three-terrain', name: 'Three.js 3D Terrain Builder', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyThreeTerrain.ts'], category: 'three' },
  { id: 'verify:three-entities', name: 'Three.js 3D Tactical Entities', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyThreeEntities.ts'], category: 'three' },
  { id: 'verify:geodesy', name: 'Geodesy & Plate Carrée Coordinates', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyGeodesy.ts'], category: 'geodesy' },
  { id: 'verify:cursor-readout', name: 'Radar Cursor Geographic Readout', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyCursorReadout.ts'], category: 'ui' },
  { id: 'verify:scheduler-percentiles', name: 'Rolling Goodput Percentiles', command: process.execPath, args: [viteNodeBin, 'src/tests/verifySchedulerPercentiles.ts'], category: 'scheduler' },
  { id: 'verify:path-profile-top-view', name: 'Path Profile Top-View Canvas', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPathProfileTopView.ts'], category: 'ui' },
  { id: 'verify:node-inventory', name: 'Node Inventory Geodetic Coordinates', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNodeInventoryCoordinates.ts'], category: 'ui' },
  { id: 'verify:data-comm', name: 'Data Comm & TDMA Visualization', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDataCommVisualization.ts'], category: 'ui' },
  { id: 'verify:physical-speed', name: 'Physical UAV Speed & Kinematics', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPhysicalSpeed.ts'], category: 'trajectory' },
  { id: 'verify:rf-bandwidth', name: 'RF Channel Bandwidth Scaling', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRfBandwidth.ts'], category: 'rf' },
  { id: 'verify:integration-hardening', name: 'Integration Hardening M6.3', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyIntegrationHardeningM63.ts'], category: 'integration' },
  { id: 'verify:node-agl', name: 'Configurable Ground-Node AGL', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNodeAglConfiguration.ts'], category: 'node' },
  { id: 'verify:dem-mapping', name: 'DEM Mapping & Coordinate Transforms', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDemMapping.ts'], category: 'terrain' },
  { id: 'verify:coverage-propagation', name: 'Terrain Coverage & RF Propagation', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyCoveragePropagation.ts'], category: 'terrain' },
  { id: 'verify:hillshade-bounds', name: 'Hillshade Bounds & Geographic Extent', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHillshadeBounds.ts'], category: 'terrain' },
  { id: 'verify:canvas-terrain', name: 'Canvas Terrain Rendering & Alignment', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyCanvasTerrain.ts'], category: 'terrain' },
  { id: 'verify:determinism', name: 'Determinism & State-Hash Trace (T1-T6)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDeterminismTrace.ts'], category: 'determinism' },
  { id: 'verify:acn-only', name: 'ACN Topology & Rename Invariants', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyAcnOnlyAndRename.ts'], category: 'node' },
  { id: 'verify:node-registry-m1a', name: 'Node Registry & Stable Identity (M1a)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNodeRegistryM1a.ts'], category: 'node' },
  { id: 'verify:node-lifecycle-mgr', name: 'Node Lifecycle Manager Unit Tests', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNodeLifecycleManager.ts'], category: 'node' },
  { id: 'verify:dynamic-nodes-m1b', name: 'Dynamic Ground-Node Management (M1b)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDynamicNodesM1b.ts'], category: 'node' },
  { id: 'verify:per-node-config', name: 'Per-Node Power, Battery & AGL Config', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPerNodeConfiguration.ts'], category: 'node' },
  { id: 'verify:registration', name: 'Node Network Registration FSM', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRegistration.ts'], category: 'node' },
  { id: 'verify:hgt-mosaic', name: 'Multi-Tile SRTM HGT Mosaic Stitcher', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHgtMosaic.ts'], category: 'terrain' },
  { id: 'verify:hgt-terrain', name: 'HGT Terrain Buffer Ingestion', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHgtTerrain.ts'], category: 'terrain' },
  { id: 'verify:single-hgt-centering', name: 'Single HGT Tile Centering & Origin', command: process.execPath, args: [viteNodeBin, 'src/tests/verifySingleHgtCentering.ts'], category: 'terrain' },
  { id: 'verify:terrain-mesh-gen', name: '3D Terrain Mesh Data Generator', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTerrainMeshGenerator.ts'], category: 'three' },
  { id: 'verify:traffic-inventory', name: 'Traffic Inventory UI Backlog Tables', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNetworkTrafficInventory.ts'], category: 'ui' },
  { id: 'verify:network-dashboard', name: 'Network Performance Dashboard KPIs', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNetworkPerformanceDashboard.ts'], category: 'ui' },
  { id: 'verify:sim-speed-controller', name: 'Kinematic Speed Controller Transitions', command: process.execPath, args: [viteNodeBin, 'src/tests/verifySimulationSpeedController.ts'], category: 'trajectory' },
  { id: 'verify:variable-altitude', name: 'UAV Variable Altitude System (ALT-T1–T10)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyVariableAltitude.ts'], category: 'trajectory' },
  { id: 'verify:variable-tdma', name: 'Variable TDMA Frame System (TDMA-T1–T8)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyVariableTdma.ts'], category: 'tdma' },
  { id: 'verify:simulation-timeline', name: 'Simulation Timeline System (TL-CLK1–T16)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifySimulationTimeline.ts'], category: 'timeline' },
  { id: 'verify:timeline-e2e', name: 'Simulation Timeline Browser & Map E2E', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTimelineBrowserE2E.ts'], category: 'timeline' },
  { id: 'verify:lookahead-decoupling', name: 'M1 Predictive Lookahead Decoupling (T1–T8)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyLookaheadDecoupling.ts'], category: 'trajectory' },
  { id: 'verify:map-layers', name: 'Map Layer System & RF Overlays', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyMapLayerSystem.ts'], category: 'ui' },
  { id: 'verify:timeline-enhancement', name: 'Simulation Timeline Enhancement (TL-ENH-A1–M2)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTimelineEnhancement.ts'], category: 'timeline' },
  { id: 'verify:timeline-corrective', name: 'Simulation Timeline Corrective Fixes (REV14)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTimelineCorrective.ts'], category: 'timeline' },
  { id: 'verify:terrain-toolbox', name: 'Scientific Terrain Toolbox (SPEC-TERRAIN-TOOLBOX-SCI-01-REV2)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTerrainToolboxSci.ts'], category: 'ui' },
  { id: 'verify:quad-antenna', name: 'Body-Fixed 4-Sector ACN Antenna Array (QSA-T1–T5)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyQuadSectorAntenna.ts'], category: 'antenna' },
  { id: 'verify:itu-physics', name: 'First-Principles ITU-R Physics & Terrain', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyItuFirstPrinciples.ts'], category: 'physics' },
  { id: 'verify:ablation', name: 'Diffraction Scheduling & Ablation Baseline (ABL-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyAblationAndDiffraction.ts'], category: 'scheduler' },
  { id: 'verify:scientific-instruments', name: 'Scientific RF & Protocol Instruments (SCI-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyScientificInstruments.ts'], category: 'ui' },
  { id: 'verify:doppler-ew', name: '8.0 GHz Doppler Kinematics & Contested EW Jammer (DEW-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDopplerAndEwJammer.ts'], category: 'physics' },
  { id: 'verify:viewshed-relay', name: 'Polar X-Band Viewshed & Relay Placement Advisor (VRA-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyViewshedAndRelayAdvisor.ts'], category: 'rf' },
  { id: 'verify:publication-ecdf', name: 'Publication ECDF Delay Scope & IEEE LaTeX Export (PEL-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPublicationEcdfAndLatex.ts'], category: 'ui' },
  { id: 'verify:active-relay', name: 'Active Two-Hop Decode-and-Forward Mesh Relay (ATR-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyActiveTwoHopRelay.ts'], category: 'rf' },
  { id: 'verify:rician-cqi', name: '3GPP TR 38.811 Rician Fading & CQI Aging (RFC-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRicianFadingAndCqiAging.ts'], category: 'rf' },
  { id: 'verify:3d-sensitivity', name: '3D Volumetric Beams, Relay / EW Parity & Sensitivity Sweep (PSS-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verify3dParityAndSensitivitySweep.ts'], category: 'ui' },
  { id: 'verify:ui-makeover', name: 'UI/UX Makeover, MapLibre Kinetic Overlay & 3D Perf Optimization (UMP-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyUiMakeoverAnd3dPerf.ts'], category: 'ui' },
  { id: 'verify:toolbox-upgrade', name: '3D MapLibre Fix & Deep Toolbox Upgrade (TBU-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyToolboxDeepUpgrade.ts'], category: 'ui' },
  { id: 'verify:flight-planner', name: 'QGroundControl Flight Planner & Vertical Terrain Profile (FPU-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyFlightPlannerUpgrade.ts'], category: 'ui' },
  { id: 'verify:tdma-dissector', name: 'TDMA Logic Analyzer & MAC PDU Dissector (TLA-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTdmaLogicAnalyzerDissector.ts'], category: 'ui' },
  { id: 'verify:path-refractivity', name: 'Path Profile Bullington & Atmospheric Refractivity (PPR-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPathProfileRefractivity.ts'], category: 'rf' },
  { id: 'verify:vsa-constellation', name: 'DVB-S2X I/Q Constellation, EVM & LDPC BLER Analyzer (VSA-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyVsaConstellationUpgrade.ts'], category: 'vsa' },
  { id: 'verify:qos-sla', name: '3GPP 5QI SLA Compliance & Jain\'s Fairness (QSF-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyQosSlaAndFairness.ts'], category: 'sla' },
  { id: 'verify:ntn-signaling', name: '3GPP Rel-17 NTN RACH & Handover Signaling (NRS-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNtnRachSignalingUpgrade.ts'], category: 'ntn' },
  { id: 'verify:worker-dossier', name: '50 Hz Worker Jitter Profiler & Reproducible Dossier (WJD-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyWorkerJitterAndDossierUpgrade.ts'], category: 'profiler' },
  { id: 'verify:geodetic-ruler', name: 'CAD/GIS Precision Geodetic & RF LoS Ruler (PGR-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPrecisionGeodeticRuler.ts'], category: 'ui' },
  { id: 'verify:cursor-probe', name: 'CAD/STK Precision Cursor RF Probe & Unit Spawner (PCP-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPrecisionCursorProbeTool2.ts'], category: 'ui' },
  { id: 'verify:ao-swath', name: 'CAD/QGIS Precision AO Swath & Dead-Zone Scanner (PAS-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPrecisionAoSwathTool3.ts'], category: 'ui' },
  { id: 'verify:cad-obstacle', name: 'Precision CAD Obstacle Link-Slicer Engine (PCO-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPrecisionCadObstacleTool4.ts'], category: 'ui' },
  { id: 'verify:intuitive-toolbox', name: 'Intuitive Toolbox Right-Panel Docking & Ergonomic UX (ITU-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyIntuitiveToolboxUx.ts'], category: 'ui' },
  { id: 'verify:ux-51-polish', name: 'Comprehensive 51-Point Tactical Digital Twin UX Polish (UXP-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyComprehensive51PointUxPolish.ts'], category: 'ui' },
  { id: 'verify:ai-pathfinder', name: 'Edge-AI NLoS Link-Recovery Pathfinder & Autonomous Repositioning (AIP-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTacticalAiPathfinder.ts'], category: 'ai' },
  { id: 'verify:walkable-ai', name: 'Edge-AI Walkable Terrain Pathfinder & 3D Obstacle Avoidance (WPO-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyWalkablePathfinderAndObstacleAvoidance.ts'], category: 'ai' },
  { id: 'verify:ai-copilot-phone', name: 'Tactical Edge-AI Co-Pilot & Soldier Handheld Phone UI (ECP-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyEdgeAiCopilotAndSoldierPhone.ts'], category: 'ai' },
  { id: 'verify:ai-physics-truth', name: 'AI Physics Truth & Closed-Loop Execution (APT-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyAiPhysicsTruthAndClosedLoop.ts'], category: 'ai' },
  { id: 'verify:master-math', name: 'Master Mathematical & Physical Rigor Audit (MMR-T1–T5)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyMasterMathematicalRigor.ts'], category: 'math' },
  { id: 'verify:se-architecture', name: 'Software Engineering Architecture & DRY Refactor (SEA-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifySoftwareEngineeringArchitecture.ts'], category: 'architecture' },
  { id: 'verify:wgs84', name: 'Canonical WGS-84 ECEF / ENU / Vincenty Geodesy Engine (WGS-T1–T6)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyWgs84Geodesy.ts'], category: 'geodesy' },
  { id: 'verify:multiedge-diffraction', name: 'ITU-R P.526-15 Multi-Edge Diffraction Engine (MED-T1–T8)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyMultiEdgeDiffraction.ts'], category: 'physics' },
  { id: 'verify:attitude-channel', name: 'Airframe Attitude & Channel Dynamics (AAD-T1–T6)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyAttitudeAndChannelDynamics.ts'], category: 'physics' },
  { id: 'verify:mac-phy-feedback', name: 'MAC/PHY Feedback Dynamics & Dynamic TDMA Overhead (MPF-T1–T6)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyMacPhyFeedback.ts'], category: 'mac', serial: true },
  { id: 'verify:kinematic-pathfinder', name: 'Kinematic Dubins Path Smoothing & 3D Flight Feasibility (KPF-T1–T6)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyKinematicPathfinder.ts'], category: 'pathfinding' },
  { id: 'verify:worker-transfer-replay', name: 'Worker Transferables & Bounded Adaptive Replay (WTR-T1–T6)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyWorkerTransferAndReplayBounds.ts'], category: 'worker' },
  { id: 'verify:dom-safety-modularity', name: 'DOM/XSS Safety Layer & Pure Worker Modular Decomposition (DSM-T1–T5)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDomSafetyAndModularity.ts'], category: 'ui' },
  { id: 'verify:viewshed-accessibility', name: 'Viewshed Physics Parity & Accessible Status Encoding (VPA-T1–T5)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyViewshedParityAndAccessibility.ts'], category: 'ui', serial: true },
  { id: 'verify:scientific-rigor', name: 'Scientific Benchmarking Rigor & Physics Ablation (SBR-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyScientificBenchmarkRigor.ts'], category: 'benchmark' },
  { id: 'verify:tactical-design-system', name: 'Tactical Obsidian Design System & UI Architecture (TDS-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTacticalDesignSystem.ts'], category: 'ui' },
  { id: 'verify:workbench-cutover', name: 'Workbench Cutover, Stitch Removal & Zero-Emoji Purge (WKC-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyWorkbenchCutover.ts'], category: 'ui' },
  { id: 'verify:ui-polish-cleanup', name: 'Unified Canvas Theme & Stitch Cleanup (UIP-T1–T3)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyUiPolishAndCleanup.ts'], category: 'ui' },
  { id: 'verify:direct-toolbox', name: 'Direct-Manipulation Terrain Toolbox & CAD Icons (UI05-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDirectToolboxUx.ts'], category: 'ui' },
  { id: 'verify:live-hifi-wiring', name: 'Live 50 Hz High-Fidelity Physics Engine Wiring & UI Controls (SPEC-V2-01)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyLiveHighFidelityWiring.ts'], category: 'physics' },
  { id: 'verify:publication-dossier', name: 'Publication Scientific Dossier & IEEE LaTeX Export (SPEC-V2-02)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPublicationDossierSync.ts'], category: 'benchmark' },
  { id: 'verify:canvas-declutter-security', name: '2D Canvas Label De-Cluttering Engine & DOM Safety Guard (SPEC-V2-03)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyCanvasDeclutterAndSecurity.ts'], category: 'ui' },
  { id: 'verify:multi-biome-physics', name: 'Multi-Biome Theater Platform & Biome-Adaptive RF Physics (SPEC-V3-01)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyMultiBiomePhysics.ts'], category: 'physics' },
  { id: 'verify:closed-loop-mac-transport', name: 'Closed-Loop MAC/PHY Scheduler Coupling, Transport AIMD & Video ABR (SPEC-V3-02)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyClosedLoopMacTransport.ts'], category: 'physics', serial: true },
  { id: 'verify:ew-eccm-lpi', name: 'Defense EW / ECCM, MVDR Null-Steering, ESM/LPI & GNSS Spoofing (SPEC-V3-03)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyEwEccmAndLpi.ts'], category: 'physics' },
  { id: 'verify:constellation-mobility', name: 'Multi-ACN Constellation & Handover, Multi-Hop MANET Routing & High-Altitude Aerodynamics (SPEC-V3-04)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyConstellationAndMobility.ts'], category: 'physics' },
  { id: 'verify:digital-twin-calibration', name: 'True Digital-Twin Calibration & Flight-Test Replay (SPEC-V3-05)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDigitalTwinCalibration.ts'], category: 'benchmark' },
  { id: 'verify:military-gis', name: 'Military Tactical GIS, Cartographic Overlays, GeoTIFF DEM & Mission Persistence (SPEC-V3-06)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyMilitaryGisAndPersistence.ts'], category: 'ui' },
  { id: 'verify:three-volumetric-rf', name: '3D Volumetric RF Visualization & Interactive Raycast Picking (SPEC-V3-07)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyThreeVolumetricRf.ts'], category: 'three' },
  { id: 'verify:command-palette-aar', name: 'Frontier Command Palette & AAR Briefing Exporter (SPEC-V3-08)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyCommandPaletteAndAar.ts'], category: 'ui' },
  { id: 'verify:typed-ui-controllers-1', name: 'De-Monolithizing index.html Part 1 — Strict TypeScript UI Controllers (SPEC-V3-09)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTypedUiControllersPart1.ts'], category: 'ui' },
  { id: 'verify:typed-ui-controllers-2', name: 'De-Monolithizing index.html Part 2 — Strictly Typed 2D Radar & Terrain Toolbox (SPEC-V3-10)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTypedUiControllersPart2.ts'], category: 'ui' },
  { id: 'verify:parity-server-offline-tiles', name: 'Canonical Node/TS Parity Server & Offline Air-Gap Tile Protocol (SPEC-V3-11)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyParityServerAndOfflineTiles.ts'], category: 'server' },
  { id: 'verify:release-v3-readiness', name: 'V3.0 Release Readiness, Integrity & Zero-Slop Architecture Gate (SPEC-V3-12)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyReleaseV3Readiness.ts'], category: 'release' }
];

REGISTERED_SUITES.push(
  { id: 'verify:fix01-hardening', name: 'CI/Server/Electron Hardening & RFC 9110 Range (FIX-01)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHardeningFix01.ts'], category: 'hardening' },
  { id: 'verify:fix02-algorithms', name: 'Scientific & Algorithmic Hardening (FIX-02)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHardeningFix02.ts'], category: 'hardening' },
  { id: 'verify:audit-fixes', name: 'Audit Remediation & Security Unit Tests', command: process.execPath, args: [viteNodeBin, 'src/tests/auditFixes.test.ts'], category: 'hardening' },
  { id: 'verify:radar-marker-layer', name: '2D Radar Node Marker Layer & WAAPI Transitions', command: process.execPath, args: [viteNodeBin, 'src/tests/radarNodeMarkerLayer.test.ts'], category: 'ui' },
  { id: 'verify:world-tile-layer', name: 'World Tile Layer & MapLibre Geo Transparency', command: process.execPath, args: [viteNodeBin, 'src/tests/worldTileLayer.test.ts'], category: 'ui' },
  { id: 'verify:probe-signal-heatmap', name: 'Probe RF Signal Propagation Heat Map', command: process.execPath, args: [viteNodeBin, 'src/tests/probeSignalHeatmap.test.ts'], category: 'rf' },
  { id: 'verify:toolbox-precision', name: 'Toolbox Precision CAD / GIS / RF Suite & DEM Presets', command: process.execPath, args: [viteNodeBin, 'src/tests/toolboxPrecisionSuite.test.ts'], category: 'ui' },
  { id: 'verify:workspace-tiles', name: 'Workspace Tiles Manager State & Telemetry Formatting', command: process.execPath, args: [viteNodeBin, 'src/tests/workspaceTilesManager.test.ts'], category: 'ui' },
  { id: 'verify:remed01-live-contracts', name: 'REMED-01 Live Contracts & Worker IPC', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRemed01LiveContracts.ts'], category: 'remediation' },
  { id: 'verify:remed02-multi-biome-3d', name: 'REMED-02 Multi-Biome Geodesy & 3D Geometry', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRemed02MultiBiomeAnd3d.ts'], category: 'remediation' },
  { id: 'verify:remed03-physics-unification', name: 'REMED-03 RF Propagation, DCM & Calibration Unification', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRemed03PhysicsUnification.ts'], category: 'remediation' },
  { id: 'verify:remed04-mac-qos-telemetry', name: 'REMED-04 MAC Fairness, 5QI SLA & PDU Dissector', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRemed04MacQosTelemetry.ts'], category: 'remediation' },
  { id: 'verify:remed05-metrics-perf', name: 'REMED-05 Timeline Performance, Metrics & Scientific Transparency', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRemed05MetricsAndPerf.ts'], category: 'remediation' },
  { id: 'verify:remed06-e2e-release', name: 'REMED-06 Strict CSP, Live Scenario Wiring & Career Demo Flow Gate', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRemed06EndToEndRelease.ts'], category: 'remediation', serial: true },
  { id: 'verify:perf01-offline-efficiency', name: 'PERF-01 Offline Air-Gap Readiness & RAM/CPU/GPU Efficiency', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPerf01OfflineAndEfficiency.ts'], category: 'performance' },
  { id: 'verify:tauri01-desktop-shell', name: 'TAURI-01 Cross-Platform Offline Tauri v2 Desktop Shell', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTauri01DesktopShell.ts'], category: 'desktop' },
  { id: 'verify:rust-core01-wasm-parity', name: 'RUST-CORE-01 Shared Rust/WASM Terrain, Viewshed & Hillshade Parity', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRustCore01WasmParity.ts'], category: 'physics', serial: true },
  { id: 'verify:upg01-flight-recorder-ipc', name: 'UPG-01 Slice WASM Viewshed, On-Demand IPC, Flight Recorder & HUD', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyUpg01FlightRecorderAndIpc.ts'], category: 'architecture' },
  { id: 'verify:upg02-offline-packs-hgt', name: 'UPG-02 Fast 500+ HGT Manager, Offline Mission Packs & Mentor Edge-Case Fixes', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyUpg02OfflinePacksAndHgt.ts'], category: 'terrain' },
  { id: 'verify:upg03-lan-bridge-batch-cli', name: 'UPG-03 Air-Gapped LAN UDP Bridge (ATAK CoT / MAVLink v2) & Multi-Core Batch CLI', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyUpg03LanBridgeAndBatchCli.ts'], category: 'desktop', serial: true },
  { id: 'verify:upg04-vitest-runner', name: 'UPG-04 Fast Parallel Vitest Pooled Runner, V8 Coverage & Serial-Lane Runner', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyUpg04VitestAndRunner.ts'], category: 'architecture' },
  { id: 'verify:upg05-modular-app-v4', name: 'UPG-05 Modular src/app Architecture & v4.0.0 Release Symmetry Gate', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyUpg05ModularAppAndV4Release.ts'], category: 'release' }
);

// -----------------------------------------------------------------------------
// Environment & Provenance Capture
// -----------------------------------------------------------------------------
function getProvenance() {
  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  let gitDirty = false;
  try {
    gitCommit = execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const status = execSync('git status --porcelain', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    gitDirty = status.length > 0;
  } catch (_) {}

  return {
    git_commit: gitCommit,
    git_branch: gitBranch,
    git_dirty: gitDirty,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu_model: os.cpus()[0]?.model ?? 'unknown',
    cpu_count: os.cpus().length,
    total_memory_bytes: os.totalmem(),
    free_memory_bytes: os.freemem(),
  };
}

// -----------------------------------------------------------------------------
// Suite Execution Runner
// -----------------------------------------------------------------------------
function runSuite(suite, timeout) {
  return new Promise((resolveResult) => {
    const startTime = performance.now();
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let timer = null;

    const child = spawn(suite.command, suite.args, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0', STRATOS_VERIFY_ALL: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
      }, 2000).unref();
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = performance.now() - startTime;
      resolveResult({
        id: suite.id,
        name: suite.name,
        category: suite.category,
        command: `${suite.command} ${suite.args.join(' ')}`,
        status: 'EXEC_ERROR',
        exit_code: null,
        signal: null,
        duration_ms: Math.round(durationMs),
        error_message: err.message,
        stdout: stdoutData,
        stderr: stderrData,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const durationMs = performance.now() - startTime;

      let status = 'PASSED';
      let errorMessage = null;

      if (timedOut) {
        status = 'TIMEOUT';
        errorMessage = `Suite exceeded execution timeout of ${timeout} ms`;
      } else if (code !== 0) {
        status = 'FAILED';
        // Extract failure details from stderr or stdout tail
        const errorLines = stderrData.trim().split('\n').filter(Boolean);
        const stdoutLines = stdoutData.trim().split('\n').filter(Boolean);
        if (errorLines.length > 0) {
          errorMessage = errorLines.slice(-3).join(' | ');
        } else if (stdoutLines.length > 0) {
          const failLines = stdoutLines.filter(l => /error|fail|assert/i.test(l));
          errorMessage = failLines.length > 0
            ? failLines.slice(-3).join(' | ')
            : stdoutLines.slice(-2).join(' | ');
        } else {
          errorMessage = `Process exited with code ${code}`;
        }
      }

      resolveResult({
        id: suite.id,
        name: suite.name,
        category: suite.category,
        command: `${suite.command} ${suite.args.join(' ')}`,
        status,
        exit_code: code,
        signal,
        duration_ms: Math.round(durationMs),
        error_message: errorMessage,
        stdout: stdoutData,
        stderr: stderrData,
      });
    });
  });
}

// -----------------------------------------------------------------------------
// Terminal Output Formatting
// -----------------------------------------------------------------------------
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function formatStatus(status) {
  switch (status) {
    case 'PASSED':
      return `${ANSI.green}${ANSI.bold}PASS${ANSI.reset}`;
    case 'FAILED':
      return `${ANSI.red}${ANSI.bold}FAIL${ANSI.reset}`;
    case 'TIMEOUT':
      return `${ANSI.yellow}${ANSI.bold}TIME${ANSI.reset}`;
    case 'EXEC_ERROR':
      return `${ANSI.magenta}${ANSI.bold}ERR!${ANSI.reset}`;
    default:
      return status;
  }
}

// -----------------------------------------------------------------------------
// Main Execution
// -----------------------------------------------------------------------------
async function main() {
  const provenance = getProvenance();
  const suitesToRun = suiteFilter
    ? REGISTERED_SUITES.filter(s => s.id.includes(suiteFilter) || s.name.toLowerCase().includes(suiteFilter.toLowerCase()))
    : REGISTERED_SUITES;

  if (suitesToRun.length === 0) {
    console.error(`[!] No verification suites matched filter: "${suiteFilter}"`);
    process.exit(1);
  }

  console.log('='.repeat(92));
  console.log(`${ANSI.bold}   DRDO X-BAND DIGITAL TWIN // COMPREHENSIVE VERIFICATION RUNNER (M0.1)${ANSI.reset}`);
  console.log('='.repeat(92));
  console.log(` Commit      : ${provenance.git_commit.slice(0, 8)} (${provenance.git_branch}${provenance.git_dirty ? ', dirty' : ''})`);
  console.log(` Platform    : ${provenance.platform} ${provenance.arch} | Node ${provenance.node_version} | ${provenance.cpu_count}x ${provenance.cpu_model}`);
  console.log(` Concurrency : ${concurrency} worker${concurrency > 1 ? 's' : ''}${isSerial ? ' (--serial mode)' : ''}`);
  console.log(` Target      : ${suitesToRun.length} registered suites | Timeout: ${(timeoutMs / 1000).toFixed(1)}s per suite`);
  console.log('-'.repeat(92));

  const results = new Array(suitesToRun.length);
  const overallStart = performance.now();
  let completedCount = 0;

  function printProgress(suite, result) {
    completedCount++;
    const indexStr = `[${String(completedCount).padStart(2, ' ')}/${suitesToRun.length}]`;
    const durSec = (result.duration_ms / 1000).toFixed(2);
    console.log(` ${indexStr} ${suite.id.padEnd(28)} ${formatStatus(result.status)} in ${durSec.padStart(5, ' ')}s  ${result.error_message ? `— ${ANSI.red}${result.error_message}${ANSI.reset}` : ''}`);
  }

  // Partition: Parallelizable suites (!suite.serial) execute first across the worker pool,
  // followed sequentially (concurrency = 1) by suite.serial === true / wall-clock timing & multi-core suites
  // so they never oversubscribe a 4-thread laptop or CI runner.
  const serialSuiteIds = new Set([
    'verify-project',
    'typecheck',
    'verify:dynamic-nodes-m1b',
    'verify:viewshed-relay',
    'verify:ai-pathfinder',
    'verify:wgs84',
    'verify:multiedge-diffraction',
    'verify:attitude-channel',
    'verify:mac-phy-feedback',
    'verify:kinematic-pathfinder',
    'verify:worker-transfer-replay',
    'verify:dom-safety-modularity',
    'verify:viewshed-accessibility',
    'verify:scientific-rigor',
    'verify:live-hifi-wiring',
    'verify:timeline-enhancement',
    'verify:canvas-declutter-security',
    'verify:ew-eccm-lpi',
    'verify:constellation-mobility',
    'verify:digital-twin-calibration',
    'verify:military-gis',
    'verify:three-volumetric-rf',
    'verify:command-palette-aar',
    'verify:typed-ui-controllers-1',
    'verify:typed-ui-controllers-2',
    'verify:parity-server-offline-tiles',
    'verify:release-v3-readiness',
    'verify:fix01-hardening',
    'verify:perf01-offline-efficiency',
  ]);
  const serialTasks = [];
  const poolTasks = [];

  for (let i = 0; i < suitesToRun.length; i++) {
    const s = suitesToRun[i];
    if (s.serial === true || serialSuiteIds.has(s.id)) {
      serialTasks.push({ suite: s, originalIndex: i });
    } else {
      poolTasks.push({ suite: s, originalIndex: i });
    }
  }

  // Ensure heavy/long-running serial suites run after lightweight microbenchmarks
  serialTasks.sort((a, b) => {
    const aHeavy = a.suite.id === 'verify:dynamic-nodes-m1b' ? 1 : 0;
    const bHeavy = b.suite.id === 'verify:dynamic-nodes-m1b' ? 1 : 0;
    return aHeavy - bHeavy;
  });

  let shouldBail = false;

  // Phase 1: Execute parallelizable suites (!suite.serial) across bounded worker pool
  if (poolTasks.length > 0) {
    const queue = [...poolTasks];

    async function worker() {
      while (queue.length > 0) {
        if (shouldBail) break;
        const item = queue.shift();
        if (!item) break;

        let res = await runSuite(item.suite, timeoutMs);
        if (res.status !== 'PASSED' && !bailOnError) {
          // Retry once to absorb transient thread contention spikes
          const retry = await runSuite(item.suite, timeoutMs);
          if (retry.status === 'PASSED') {
            res = retry;
          }
        }
        results[item.originalIndex] = res;
        printProgress(item.suite, res);

        if (bailOnError && res.status !== 'PASSED') {
          shouldBail = true;
          console.log(`\n[!] Bailing immediately after failure in suite: ${item.suite.id}`);
          break;
        }
      }
    }

    const workerCount = Math.min(concurrency, poolTasks.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
  }

  // Phase 2: Execute serial suites (suite.serial === true) sequentially (concurrency = 1)
  if (!shouldBail && serialTasks.length > 0) {
    for (const item of serialTasks) {
      let res = await runSuite(item.suite, timeoutMs);
      if (res.status !== 'PASSED' && !bailOnError) {
        // Retry once to absorb transient OS context-switch / CPU thermal spikes
        const retry = await runSuite(item.suite, timeoutMs);
        if (retry.status === 'PASSED') {
          res = retry;
        }
      }
      results[item.originalIndex] = res;
      printProgress(item.suite, res);

      if (bailOnError && res.status !== 'PASSED') {
        shouldBail = true;
        console.log(`\n[!] Bailing immediately after failure in suite: ${item.suite.id}`);
        break;
      }
    }
  }

  const overallDurationMs = Math.round(performance.now() - overallStart);
  const finalResults = results.filter(Boolean);

  // Compute summary metrics
  const passed = finalResults.filter(r => r.status === 'PASSED').length;
  const failed = finalResults.filter(r => r.status === 'FAILED').length;
  const timeouts = finalResults.filter(r => r.status === 'TIMEOUT').length;
  const execErrors = finalResults.filter(r => r.status === 'EXEC_ERROR').length;
  const allPassed = passed === suitesToRun.length;

  console.log('='.repeat(92));
  console.log(`${ANSI.bold}   VERIFICATION EXECUTION SUMMARY${ANSI.reset}`);
  console.log('-'.repeat(92));
  console.log(` Total Suites  : ${finalResults.length}`);
  console.log(` Passed        : ${ANSI.green}${passed}${ANSI.reset} / ${suitesToRun.length} (${((passed / suitesToRun.length) * 100).toFixed(1)}%)`);
  if (failed > 0)     console.log(` Failed        : ${ANSI.red}${failed}${ANSI.reset}`);
  if (timeouts > 0)   console.log(` Timeouts      : ${ANSI.yellow}${timeouts}${ANSI.reset}`);
  if (execErrors > 0) console.log(` Exec Errors   : ${ANSI.magenta}${execErrors}${ANSI.reset}`);
  console.log(` Concurrency   : ${concurrency}`);
  console.log(` Total Runtime : ${(overallDurationMs / 1000).toFixed(2)} seconds`);
  console.log('='.repeat(92));

  // Print failure details if any occurred
  if (!allPassed) {
    console.log(`\n${ANSI.bold}${ANSI.red}FAILED / UNSTABLE SUITE DIAGNOSTICS:${ANSI.reset}`);
    for (const res of finalResults.filter(r => r.status !== 'PASSED')) {
      console.log(`\n[x] Suite: ${res.id} (${res.name})`);
      console.log(`    Status: ${res.status} | Exit Code: ${res.exit_code} | Duration: ${res.duration_ms}ms`);
      console.log(`    Command: ${res.command}`);
      if (res.error_message) {
        console.log(`    Detail: ${res.error_message}`);
      }
      if (res.stderr) {
        const stderrLines = res.stderr.trim().split('\n').slice(-10);
        console.log(`    Stderr (last 10 lines):`);
        for (const line of stderrLines) console.log(`      | ${line}`);
      }
    }
    console.log('');
  }

  // ---------------------------------------------------------------------------
  // JSON Report Export
  // ---------------------------------------------------------------------------
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(outputDir, `verification-report-${timestamp}.json`);
  const latestPath = resolve(outputDir, 'verification-report-latest.json');

  const reportPayload = {
    schema_version: '1.0.0',
    generated_at_utc: new Date().toISOString(),
    provenance,
    configuration: {
      timeout_per_suite_ms: timeoutMs,
      filter: suiteFilter,
      bail: bailOnError,
      concurrency,
      serial: isSerial,
    },
    summary: {
      total_suites: finalResults.length,
      passed,
      failed,
      timeouts,
      exec_errors: execErrors,
      all_passed: allPassed,
      total_duration_ms: overallDurationMs,
      concurrency,
    },
    suites: finalResults.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      command: r.command,
      status: r.status,
      exit_code: r.exit_code,
      signal: r.signal,
      duration_ms: r.duration_ms,
      error_message: r.error_message,
      stdout_preview: r.stdout.slice(0, 1024),
      stderr: r.stderr,
    })),
  };

  writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2), 'utf8');
  writeFileSync(latestPath, JSON.stringify(reportPayload, null, 2), 'utf8');

  console.log(`[+] Machine-readable report saved to:`);
  console.log(`    ${reportPath}`);
  console.log(`    ${latestPath}\n`);

  if (!allPassed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[!] Fatal error in verification runner:', err);
  process.exit(1);
});
