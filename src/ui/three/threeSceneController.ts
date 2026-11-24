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

export class ThreeSceneController extends ThreeSceneManager {
  public readonly volumetricRfLayer: ThreeVolumetricRfLayer;
  private readonly nodePickedCallbacks: Array<(nodeId: number) => void> = [];
  private latestFrame: any = null;

  // Click-vs-drag pointer disambiguation state (< 5 px threshold)
  private static readonly CLICK_DRAG_MAX_DISPLACEMENT_PX = 5.0;
  private pointerDownX: number = 0;
  private pointerDownY: number = 0;
  private isPointerDownValid: boolean = false;

  private boundPointerDown: ((e: PointerEvent | MouseEvent) => void) | null = null;
  private boundPointerUp: ((e: PointerEvent | MouseEvent) => void) | null = null;

  constructor(config: ThreeRendererConfig, initialOptions?: Partial<VolumetricRfOptions>) {
    super(config);

    // Mount Volumetric RF Layer to Three.js root scene
    this.volumetricRfLayer = new ThreeVolumetricRfLayer(initialOptions);
    this.scene.add(this.volumetricRfLayer.rootGroup);

    this.setupPickingPointerListeners();
  }

  private setupPickingPointerListeners(): void {
    if (!this.canvas || typeof this.canvas.addEventListener !== 'function') return;

    this.boundPointerDown = (e: PointerEvent | MouseEvent) => {
      if (e.button !== 0) {
        this.isPointerDownValid = false;
        return;
      }
      this.pointerDownX = e.clientX;
      this.pointerDownY = e.clientY;
      this.isPointerDownValid = true;
    };

    this.boundPointerUp = (e: PointerEvent | MouseEvent) => {
      if (!this.isPointerDownValid || e.button !== 0) {
        this.isPointerDownValid = false;
        return;
      }
      this.isPointerDownValid = false;

      if (this.getViewMode() !== '3d') return;

      const dx = e.clientX - this.pointerDownX;
      const dy = e.clientY - this.pointerDownY;
      const displacement = Math.hypot(dx, dy);

      // Strict < 5 px click-vs-drag guard: camera orbit/pan gestures are never treated as picks
      if (displacement < ThreeSceneController.CLICK_DRAG_MAX_DISPLACEMENT_PX) {
        this.performRaycastPicking(e.clientX, e.clientY);
      }
    };

    this.canvas.addEventListener('pointerdown', this.boundPointerDown);
    this.canvas.addEventListener('pointerup', this.boundPointerUp);
    this.canvas.addEventListener('mousedown', this.boundPointerDown);
    this.canvas.addEventListener('mouseup', this.boundPointerUp);
  }

  private removePickingPointerListeners(): void {
    if (!this.canvas || typeof this.canvas.removeEventListener !== 'function') return;

    if (this.boundPointerDown) {
      this.canvas.removeEventListener('pointerdown', this.boundPointerDown);
      this.canvas.removeEventListener('mousedown', this.boundPointerDown);
      this.boundPointerDown = null;
    }
    if (this.boundPointerUp) {
      this.canvas.removeEventListener('pointerup', this.boundPointerUp);
      this.canvas.removeEventListener('mouseup', this.boundPointerUp);
      this.boundPointerUp = null;
    }
  }

  /**
   * Performs 3D raycast picking from canvas coordinates through camera to entities.
   */
  public performRaycastPicking(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    // Use raycaster from super
    const raycaster = (this as any).raycaster as THREE.Raycaster ?? new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    // Build selectable candidate objects
    const targets = this.tacticalEntityManager.getSelectableObjects();
    const candidateObjects: THREE.Object3D[] = targets.filter(isObjectVisibleInHierarchy);
    const terrainMesh = (this as any).terrainMesh as THREE.Mesh | null;
    if (terrainMesh && terrainMesh.visible && isObjectVisibleInHierarchy(terrainMesh)) {
      candidateObjects.push(terrainMesh);
    }

    const hits = raycaster.intersectObjects(candidateObjects, false);
    if (hits.length === 0) return null;

    // Direct object hit check (e.g. marker sprite or ACN)
    const directHit = hits.find(
      (h) => isObjectVisibleInHierarchy(h.object) &&
        (typeof h.object.userData?.nodeId === 'number' || h.object.userData?.isAcn === true)
    );

    const terrainHit = hits.find((h) => h.object === terrainMesh);
    if (directHit) {
      if (terrainHit && terrainHit.distance < directHit.distance) {
        // Intervening mountain ridge occludes target
        return null;
      }
      const nodeId = directHit.object.userData?.isAcn === true ? -1 : directHit.object.userData?.nodeId;
      if (typeof nodeId === 'number') {
        this.notifyNodePicked(nodeId);
        return nodeId;
      }
    }

    // World-hit proximity picking against ground terminal positions
    if (terrainHit && this.latestFrame && Array.isArray(this.latestFrame.nodes_telemetry)) {
      const hitPoint = terrainHit.point;
      const pickables: PickableEntity[] = [];

      for (const node of this.latestFrame.nodes_telemetry) {
        if (!node || node.is_mapped === false) continue;
        const rootPos = simToThreeCoords(node.x_m ?? 0, node.y_m ?? 0, node.z_m ?? 0);
        pickables.push({
          id: node.node_id,
          positionWorld: [rootPos.x, rootPos.y, rootPos.z],
        });
      }

      // Max proximity picking radius in world units (e.g. 8,000 m)
      const pickedId = pickNearestEntityFromWorldHit(
        [hitPoint.x, hitPoint.y, hitPoint.z],
        pickables,
        8000.0
      );

      if (pickedId !== null) {
        this.notifyNodePicked(pickedId);
        return pickedId;
      }
    }

    return null;
  }

  private notifyNodePicked(nodeId: number): void {
    this.setSelectedNode(nodeId);
    for (const cb of this.nodePickedCallbacks) {
      try {
        cb(nodeId);
      } catch (err) {
        console.error('[ThreeSceneController] Error in nodePicked callback:', err);
      }
    }
  }

  /**
   * Registers a callback invoked whenever a 3D node is selected via raycast picking.
   */
  public onNodePicked(callback: (nodeId: number) => void): void {
    this.nodePickedCallbacks.push(callback);
  }

  public override onNodeSelected(callback: (nodeId: number) => void): void {
    super.onNodeSelected(callback);
    this.nodePickedCallbacks.push(callback);
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
    this.removePickingPointerListeners();
    this.nodePickedCallbacks.length = 0;
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
