/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Three.js 3D Subsystem — Authoritative Scene Controller (M6.2.3 / V3-07)
 *
 * Extends ThreeSceneManager with:
 * 1. 3D Volumetric RF Visualization Layer (ThreeVolumetricRfLayer)
 * 2. setVolumetricRfOptions(...) & getVolumetricRfOptions() API
 * 3. Click-vs-drag < 5 px 3D raycast picking with pickNearestEntityFromWorldHit
 * 4. Zero-leak lifecycle management with full dispose()
 */

import * as THREE from 'three';
import { ThreeSceneManager } from './sceneManager';
import {
  simToThreeCoords,
  ThreeRendererConfig,
  ThreeSceneMetrics,
  VolumetricRfOptions,
  VolumetricRfState,
} from './threeTypes';
import { ThreeVolumetricRfLayer } from './threeVolumetricRfLayer';
import {
  pickNearestEntityFromWorldHit,
  PickableEntity,
} from './threeVolumetricRfMath';
import { readActiveCanvasCvdMode } from '../canvasTheme';
import { isObjectVisibleInHierarchy } from './tacticalEntityManager';
import { MAX_ACTIVE_GROUND_NODES } from '../../shared/constants';

export class ThreeSceneController extends ThreeSceneManager {
  public readonly volumetricRfLayer: ThreeVolumetricRfLayer;
  private latestFrame: any = null;

  private boundContextLost: ((e: Event) => void) | null = null;
  private boundContextRestored: ((e: Event) => void) | null = null;
  private contextLostPaused: boolean = false;

  constructor(config: ThreeRendererConfig, initialOptions?: Partial<VolumetricRfOptions>) {
    super(config);

    // Mount Volumetric RF Layer to Three.js root scene
    this.volumetricRfLayer = new ThreeVolumetricRfLayer(initialOptions);
    this.scene.add(this.volumetricRfLayer.rootGroup);

    this.setupContextRecoveryListeners();
  }

  private setupContextRecoveryListeners(): void {
    if (!this.canvas || typeof this.canvas.addEventListener !== 'function') return;

    this.boundContextLost = (e: Event) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      this.contextLostPaused = true;
      (this as any).isContextLost = true;
      this.stopAnimationLoop();
    };

    this.boundContextRestored = () => {
      this.contextLostPaused = false;
      (this as any).isContextLost = false;
      this.handleResize();
      if (this.latestFrame && this.getViewMode() === '3d') {
        const selectedNodeId = this.tacticalEntityManager.getSelectedNodeId?.() ?? null;
        const cvdMode = readActiveCanvasCvdMode();
        this.volumetricRfLayer.update(this.latestFrame, { selectedNodeId, cvdMode });
      }
      if (this.getViewMode() === '3d') {
        this.startAnimationLoop();
        this.render();
      }
    };

    this.canvas.addEventListener('webglcontextlost', this.boundContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.boundContextRestored);
  }

  private removeContextRecoveryListeners(): void {
    if (!this.canvas || typeof this.canvas.removeEventListener !== 'function') return;

    if (this.boundContextLost) {
      this.canvas.removeEventListener('webglcontextlost', this.boundContextLost);
      this.boundContextLost = null;
    }
    if (this.boundContextRestored) {
      this.canvas.removeEventListener('webglcontextrestored', this.boundContextRestored);
      this.boundContextRestored = null;
    }
  }

  public isWebGlContextLost(): boolean {
    return this.contextLostPaused || Boolean((this as any).isContextLost);
  }

  /**
   * Authoritative 3D raycast picking override combining direct entity picking
   * with world-hit proximity fallback (invoked once per click via ThreeSceneManager).
   */
  public override handlePointerClick(ndcX: number, ndcY: number): number | null {
    const raycaster = (this as any).raycaster as THREE.Raycaster ?? new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    const targets = this.tacticalEntityManager.getSelectableObjects();
    const candidateObjects: THREE.Object3D[] = targets.filter(isObjectVisibleInHierarchy);
    const terrainMesh = (this as any).terrainMesh as THREE.Mesh | null;
    if (terrainMesh && terrainMesh.visible && isObjectVisibleInHierarchy(terrainMesh)) {
      candidateObjects.push(terrainMesh);
    }

    const hits = raycaster.intersectObjects(candidateObjects, false);
    if (hits.length === 0) return null;

    const directHit = hits.find(
      (h) =>
        isObjectVisibleInHierarchy(h.object) &&
        (typeof h.object.userData?.nodeId === 'number' || h.object.userData?.isAcn === true)
    );
    const terrainHit = hits.find((h) => h.object === terrainMesh);

    if (directHit) {
      if (terrainHit && terrainHit.distance < directHit.distance) {
        return null;
      }
      if (directHit.object.userData?.isAcn === true || directHit.object.userData?.nodeId === -1) {
        this.tacticalEntityManager.triggerNodeSelected(-1);
        return -1;
      }
      const nodeId = directHit.object.userData?.nodeId;
      if (typeof nodeId === 'number' && nodeId >= 0 && nodeId < MAX_ACTIVE_GROUND_NODES) {
        if (this.tacticalEntityManager.isNodeContactOccluded(nodeId)) {
          return null;
        }
        this.tacticalEntityManager.triggerNodeSelected(nodeId);
        return nodeId;
      }
    }

    // World-hit proximity picking against ground terminal positions
    if (terrainHit && this.latestFrame && Array.isArray(this.latestFrame.nodes_telemetry)) {
      const hitPoint = terrainHit.point;
      const pickables: PickableEntity[] = [];

      for (const node of this.latestFrame.nodes_telemetry) {
        if (!node || node.is_mapped === false) continue;
        if (this.tacticalEntityManager.isNodeContactOccluded(node.node_id)) continue;
        const rootPos = simToThreeCoords(node.x_m ?? 0, node.y_m ?? 0, node.z_m ?? 0);
        pickables.push({
          id: node.node_id,
          positionWorld: [rootPos.x, rootPos.y, rootPos.z],
        });
      }

      const pickedId = pickNearestEntityFromWorldHit(
        [hitPoint.x, hitPoint.y, hitPoint.z],
        pickables,
        8000.0
      );

      if (pickedId !== null && pickedId >= 0 && pickedId < MAX_ACTIVE_GROUND_NODES) {
        this.tacticalEntityManager.triggerNodeSelected(pickedId);
        return pickedId;
      }
    }

    return null;
  }

  /**
   * Performs 3D raycast picking from canvas coordinates through camera to entities.
   */
  public performRaycastPicking(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    return this.handlePointerClick(ndcX, ndcY);
  }

  /**
   * Registers a callback invoked whenever a 3D node is selected via raycast picking.
   */
  public onNodePicked(callback: (nodeId: number) => void): void {
    super.onNodeSelected(callback);
  }

  public override onNodeSelected(callback: (nodeId: number) => void): void {
    super.onNodeSelected(callback);
  }

  public setVolumetricRfOptions(options: Partial<VolumetricRfOptions>): void {
    this.volumetricRfLayer.setOptions(options);
    if (this.latestFrame && this.getViewMode() === '3d') {
      const selectedNodeId = this.tacticalEntityManager.getSelectedNodeId?.() ?? null;
      const cvdMode = readActiveCanvasCvdMode();
      this.volumetricRfLayer.update(this.latestFrame, { selectedNodeId, cvdMode });
    }
  }

  public getVolumetricRfOptions(): VolumetricRfOptions {
    return this.volumetricRfLayer.getOptions();
  }

  public getVolumetricRfState(): VolumetricRfState {
    return this.volumetricRfLayer.getState();
  }

  public override updateTelemetry(frame: any): void {
    this.latestFrame = frame;
    super.updateTelemetry(frame);

    if (this.getViewMode() === '3d') {
      const selectedNodeId = this.tacticalEntityManager.getSelectedNodeId?.() ?? null;
      const cvdMode = readActiveCanvasCvdMode();
      this.volumetricRfLayer.update(frame, { selectedNodeId, cvdMode });
    }
  }

  public override getMetrics(): ThreeSceneMetrics {
    const baseMetrics = super.getMetrics();
    return {
      ...baseMetrics,
      volumetricRf: this.volumetricRfLayer.getState(),
    };
  }

  public override dispose(): void {
    this.removeContextRecoveryListeners();
    this.volumetricRfLayer.dispose();
    if (this.volumetricRfLayer.rootGroup.parent) {
      this.volumetricRfLayer.rootGroup.parent.remove(this.volumetricRfLayer.rootGroup);
    }
    super.dispose();
  }
}

/**
 * Creates and initializes the authoritative Three.js Scene Controller with Volumetric RF
 */
export function createThreeSceneController(
  config: ThreeRendererConfig,
  initialOptions?: Partial<VolumetricRfOptions>
): ThreeSceneController {
  return new ThreeSceneController(config, initialOptions);
}
