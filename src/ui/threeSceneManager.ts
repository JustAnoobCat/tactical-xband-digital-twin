/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Three.js 3D Subsystem — Authoritative Scene Manager Facade
 *
 * Provides access to ThreeSceneManager, TacticalEntityManager, and pre-allocated 3D assets:
 * - 4 Body-Fixed Rotating 3D Sector Cones (acnSectorGroup with -15° downtilt)
 * - 3D [MCP-OPT] Relay Mast & 2-Hop Mesh Vectors (relayMastMesh, relayBackhaulLine)
 * - 3D EW Jammer Emitter Beacon & Interference Vector (jammerMesh, jammerRayLine)
 */

export * from './three/sceneManager';
export * from './three/tacticalEntityManager';
export * from './three/terrainBuilder';
export * from './three/terrainRenderer';
export * from './three/threeTypes';
export * from './three/index';
export { ThreeSceneManager } from './three/sceneManager';
export { TacticalEntityManager } from './three/tacticalEntityManager';
