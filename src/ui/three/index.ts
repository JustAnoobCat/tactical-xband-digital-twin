/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Three.js 3D Subsystem — Public Facade & Controller (M6.2.1)
 */

export * from './threeTypes';
export * from './sceneManager';
export * from './terrainBuilder';
export * from './tacticalEntityManager';

import { ThreeSceneManager } from './sceneManager';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CameraPresetConfig,
  StageViewMode,
  TerrainMeshDataPayload,
  TerrainMeshResolution,
  ThreeRendererConfig,
  ThreeSceneMetrics,
} from './threeTypes';

export interface ThreeStageController {
  readonly sceneManager: ThreeSceneManager;
  getViewMode(): StageViewMode;
  setViewMode(mode: StageViewMode): void;
  loadTerrainMeshData(data: TerrainMeshDataPayload): void;
  setTerrainResolution(resolution: TerrainMeshResolution): void;
  getTerrainResolution(): TerrainMeshResolution;
  setHillshadeCanvas(canvas: HTMLCanvasElement): void;
  updateTelemetry(frame: any): void;
  setSelectedNode(nodeId: number): void;
  onNodeSelected(callback: (nodeId: number) => void): void;
  getMetrics(): ThreeSceneMetrics;
  handleResize(width?: number, height?: number): void;
  resetCamera(preset?: CameraPresetConfig): void;
  getControls(): OrbitControls | null;
  dispose(): void;
}

/**
 * Creates and initializes the authoritative Three.js Stage Controller
 */
export function createThreeStageController(config: ThreeRendererConfig): ThreeStageController {
  const sceneManager = new ThreeSceneManager(config);

  return {
    sceneManager,
    getViewMode: () => sceneManager.getViewMode(),
    setViewMode: (mode: StageViewMode) => sceneManager.setViewMode(mode),
    loadTerrainMeshData: (data: TerrainMeshDataPayload) => sceneManager.loadTerrainMeshData(data),
    setTerrainResolution: (res: TerrainMeshResolution) => sceneManager.setTerrainResolution(res),
    getTerrainResolution: () => sceneManager.getTerrainResolution(),
    setHillshadeCanvas: (canvas: HTMLCanvasElement) => sceneManager.setHillshadeCanvas(canvas),
    updateTelemetry: (frame: any) => sceneManager.updateTelemetry(frame),
    setSelectedNode: (nodeId: number) => sceneManager.setSelectedNode(nodeId),
    onNodeSelected: (callback: (nodeId: number) => void) => sceneManager.onNodeSelected(callback),
    getMetrics: () => sceneManager.getMetrics(),
    handleResize: (w?: number, h?: number) => sceneManager.handleResize(w, h),
    resetCamera: (preset?: CameraPresetConfig) => sceneManager.resetCamera(preset),
    getControls: () => sceneManager.getControls(),
    dispose: () => sceneManager.dispose(),
  };
}

