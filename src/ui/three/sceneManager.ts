/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Three.js 3D Subsystem — Scene Manager & Viewport Controller (M6.2.1)
 *
 * Implements authoritative Three.js scene graph, WebGLRenderer lifecycle,
 * resize observation, WebGL context loss/restoration handling, and strict
 * single-RAF animation loop management.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CAMERA_PRESETS,
  CameraPresetConfig,
  StageViewMode,
  TerrainMeshDataPayload,
  TerrainMeshResolution,
  ThreeRendererConfig,
  ThreeSceneMetrics,
} from './threeTypes';
import {
  APPROVED_SKIRT_BASE_MSL_M,
  buildTacticalDatumGrid,
  buildTerrainGeometrySet,
} from './terrainBuilder';
import { isObjectVisibleInHierarchy, TacticalEntityManager } from './tacticalEntityManager';

export class ThreeSceneManager {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly worldGroup: THREE.Group;
  public readonly container: HTMLElement;
  public readonly canvas: HTMLCanvasElement;
  public readonly tacticalEntityManager: TacticalEntityManager;
  public readonly controls: OrbitControls | null = null;

  private static readonly DRAG_THRESHOLD_PX: number = 5.0;
  private isPointerDragging: boolean = false;
  private pointerDownPos: { x: number; y: number } | null = null;
  private canvasPointerDownListener: ((e: MouseEvent | PointerEvent) => void) | null = null;
  private canvasPointerMoveListener: ((e: MouseEvent | PointerEvent) => void) | null = null;
  private canvasPointerUpListener: ((e: MouseEvent | PointerEvent) => void) | null = null;
  private canvasWheelListener: ((e: WheelEvent) => void) | null = null;

  private isRunning: boolean = false;
  private isContextLost: boolean = false;
  private viewMode: StageViewMode = '2d';
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private windowResizeListener: (() => void) | null = null;
  private raycaster: THREE.Raycaster;
  private canvasClickListener: ((e: MouseEvent) => void) | null = null;

  private lastFrameTimestampMs: number = 0;
  private frameCount: number = 0;
  private currentFps: number = 0;
  private lastFpsCalcTimestampMs: number = 0;
  private currentFrameTimeMs: number = 0;
  private totalRenderCount: number = 0;

  // Placeholder root objects
  private placeholderGroup: THREE.Group;

  // Authentic Terrain Geometry & Visualization State (M6.2.2)
  private cachedTerrainData: TerrainMeshDataPayload | null = null;
  private terrainResolution: TerrainMeshResolution = 'native512';
  private terrainMesh: THREE.Mesh | null = null;
  private skirtMesh: THREE.Mesh | null = null;
  private datumGrid: THREE.Group | null = null;
  private hillshadeTexture: THREE.CanvasTexture | null = null;

  constructor(config: ThreeRendererConfig) {
    this.container = config.container;

    // 1. Initialize Canvas and WebGLRenderer
    if (config.canvas) {
      this.canvas = config.canvas;
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'three-viewport-canvas';
      this.canvas.style.position = 'absolute';
      this.canvas.style.inset = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.display = 'block';
      this.container.appendChild(this.canvas);
    }

    const maxPr = config.maxPixelRatio ?? 2;
    const pixelRatio = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, maxPr);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: config.antialias ?? true,
      alpha: false,
      powerPreference: config.powerPreference ?? 'high-performance',
    });

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setClearColor(config.clearColor ?? 0x080c10, config.clearAlpha ?? 1.0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // 2. Initialize Scene & Root Camera (Camera is in Three.js root space)
    this.scene = new THREE.Scene();

    const initialWidth = Math.max(10, this.container.clientWidth || 800);
    const initialHeight = Math.max(10, this.container.clientHeight || 600);
    this.camera = new THREE.PerspectiveCamera(45, initialWidth / initialHeight, 100, 2500000);

    // Apply default tactical camera preset
    this.applyCameraPreset(CAMERA_PRESETS.TACTICAL);

    // Initialize interactive OrbitControls for tactical 3D map navigation (M6.2.3-A)
    try {
      this.controls = new OrbitControls(this.camera, this.canvas);
      this.controls.target.copy(CAMERA_PRESETS.TACTICAL.target);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.screenSpacePanning = true;
      this.controls.minDistance = 3000.0;     // 3 km minimum zoom prevents surface penetration
      this.controls.maxDistance = 300000.0;   // 300 km maximum zoom keeps theater visible
      this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // ~87 deg strictly prevents orbiting below horizon
      this.controls.minPolarAngle = 0.05;     // prevents gimbal singularity at direct nadir
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN,
      };
      this.controls.enabled = (this.viewMode === '3d');
      this.controls.update();
    } catch (err) {
      console.warn('[ThreeSceneManager] Failed to initialize OrbitControls:', err);
      this.controls = null;
    }

    // 3. Initialize worldGroup with approved coordinate rotation: -PI/2 around X
    // Inside worldGroup:
    //   +X = East (m)
    //   +Y = North (m)
    //   +Z = Altitude MSL (m)
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'worldGroup';
    this.worldGroup.rotation.x = -Math.PI / 2;
    this.scene.add(this.worldGroup);

    // 4. Lighting setup (Three.js root space)
    const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.65);
    ambientLight.name = 'ambientLight';
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.25);
    sunLight.name = 'sunLight';
    // Sun shining from South-East at high elevation
    sunLight.position.set(50000, 120000, 80000);
    this.scene.add(sunLight);

    // 5. M6.2.3 Tactical 3D Entities Subsystem (ACN, Terminals, Trajectory, Links)
    this.tacticalEntityManager = new TacticalEntityManager();
    this.worldGroup.add(this.tacticalEntityManager.rootGroup);
    this.raycaster = new THREE.Raycaster();

    // 6. M6.2.1 Placeholder visual indicators (NO fake terrain)
    this.placeholderGroup = new THREE.Group();
    this.placeholderGroup.name = 'm621PlaceholderGroup';
    this.setupPlaceholderVisuals();
    this.worldGroup.add(this.placeholderGroup);

    // 7. Setup listeners & observers
    this.setupContextListeners();
    this.setupResizeObservation();
    this.setupPointerListeners();

    // Initial sizing
    this.handleResize(initialWidth, initialHeight);
  }

  /**
   * Constructs explicit non-physical visual orientation aids for M6.2.1.
   * Clearly shows coordinate axes and DEM geographic footprint without generating fake elevation.
   */
  private setupPlaceholderVisuals(): void {
    // Coordinate axes inside worldGroup (+X East in red, +Y North in green, +Z Up in cyan)
    // Length: 25 km axes
    const axisLen = 25000;
    const axesHelper = new THREE.AxesHelper(axisLen);
    axesHelper.name = 'tacticalAxesHelper';
    this.placeholderGroup.add(axesHelper);

    // Demarcation bounding rectangle of authentic Ladakh DEM:
    // X: +/- 91,839.98 m, Y: +/- 110,931.45 m, rendered at base datum Z = 1,700 m MSL
    const halfW = 91839.98;
    const halfH = 110931.45;
    const datumZ = 1700.0;

    const points = [
      new THREE.Vector3(-halfW, -halfH, datumZ),
      new THREE.Vector3(halfW, -halfH, datumZ),
      new THREE.Vector3(halfW, halfH, datumZ),
      new THREE.Vector3(-halfW, halfH, datumZ),
      new THREE.Vector3(-halfW, -halfH, datumZ),
    ];
    const boundaryGeo = new THREE.BufferGeometry().setFromPoints(points);
    const boundaryMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      linewidth: 1.5,
      transparent: true,
      opacity: 0.75,
    });
    const boundaryLine = new THREE.Line(boundaryGeo, boundaryMat);
    boundaryLine.name = 'demFootprintOutline';
    this.placeholderGroup.add(boundaryLine);

    // Origin reticle crosshair at (0, 0, datumZ)
    const crossSize = 10000;
    const crossPoints = [
      new THREE.Vector3(-crossSize, 0, datumZ),
      new THREE.Vector3(crossSize, 0, datumZ),
      new THREE.Vector3(0, -crossSize, datumZ),
      new THREE.Vector3(0, crossSize, datumZ),
    ];
    const crossGeo = new THREE.BufferGeometry().setFromPoints(crossPoints);
    const crossMat = new THREE.LineBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.5,
    });
    const crossSegments = new THREE.LineSegments(crossGeo, crossMat);
    crossSegments.name = 'originCrosshairs';
    this.placeholderGroup.add(crossSegments);
  }

  /**
   * Applies a standard camera preset (position, target, up vector, fov)
   */
  public applyCameraPreset(preset: CameraPresetConfig): void {
    this.camera.position.copy(preset.position);
    this.camera.up.copy(preset.up);
    if (preset.fovDeg !== undefined && preset.fovDeg !== this.camera.fov) {
      this.camera.fov = preset.fovDeg;
    }
    this.camera.lookAt(preset.target);
    this.camera.updateProjectionMatrix();
  }

  /**
   * WebGL Context loss and restoration safety
   */
  private setupContextListeners(): void {
    const onContextLost = (event: Event) => {
      event.preventDefault();
      console.warn('[ThreeSceneManager] WebGL context lost. Halting render loop.');
      this.isContextLost = true;
      this.stopAnimationLoop();
    };

    const onContextRestored = () => {
      console.log('[ThreeSceneManager] WebGL context restored. Re-syncing state.');
      this.isContextLost = false;
      this.handleResize();
      if (this.viewMode === '3d') {
        this.startAnimationLoop();
      }
    };

    this.canvas.addEventListener('webglcontextlost', onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', onContextRestored, false);
  }

  /**
   * Resize observation setup
   */
  private setupResizeObservation(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === this.container) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
              this.handleResize(width, height);
            }
          }
        }
      });
      this.resizeObserver.observe(this.container);
    }

    if (typeof window !== 'undefined') {
      this.windowResizeListener = () => {
        if (this.container.clientWidth > 0 && this.container.clientHeight > 0) {
          this.handleResize(this.container.clientWidth, this.container.clientHeight);
        }
      };
      window.addEventListener('resize', this.windowResizeListener, { passive: true });
    }
  }

  /**
   * Pointer interaction setup for 3D camera controls and node selection.
   * Differentiates drags (orbit/pan) from genuine clicks (terminal selection)
   * using an explicit 5 px movement threshold.
   */
  private setupPointerListeners(): void {
    if (this.canvas && typeof this.canvas.addEventListener === 'function') {
      this.canvasPointerDownListener = (e: MouseEvent | PointerEvent) => {
        this.pointerDownPos = { x: e.clientX, y: e.clientY };
        this.isPointerDragging = false;
      };

      this.canvasPointerMoveListener = (e: MouseEvent | PointerEvent) => {
        if (this.pointerDownPos) {
          const dx = e.clientX - this.pointerDownPos.x;
          const dy = e.clientY - this.pointerDownPos.y;
          if (Math.hypot(dx, dy) >= ThreeSceneManager.DRAG_THRESHOLD_PX) {
            this.isPointerDragging = true;
          }
        }
      };

      this.canvasPointerUpListener = (_e: MouseEvent | PointerEvent) => {
        this.pointerDownPos = null;
      };

      this.canvasWheelListener = (_e: WheelEvent) => {
        this.isPointerDragging = true;
      };

      this.canvasClickListener = (e: MouseEvent) => {
        if (this.viewMode !== '3d') return;
        if (this.isPointerDragging) {
          // Camera orbit/pan drag or wheel zoom occurred; suppress terminal picking
          this.isPointerDragging = false;
          return;
        }
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.handlePointerClick(ndcX, ndcY);
      };

      this.canvas.addEventListener('pointerdown', this.canvasPointerDownListener);
      this.canvas.addEventListener('pointermove', this.canvasPointerMoveListener);
      this.canvas.addEventListener('pointerup', this.canvasPointerUpListener);
      this.canvas.addEventListener('mousedown', this.canvasPointerDownListener);
      this.canvas.addEventListener('mousemove', this.canvasPointerMoveListener);
      this.canvas.addEventListener('mouseup', this.canvasPointerUpListener);
      this.canvas.addEventListener('wheel', this.canvasWheelListener, { passive: true });
      this.canvas.addEventListener('click', this.canvasClickListener);

      const doc = this.canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('pointermove', this.canvasPointerMoveListener);
        doc.addEventListener('pointerup', this.canvasPointerUpListener);
        doc.addEventListener('mousemove', this.canvasPointerMoveListener);
        doc.addEventListener('mouseup', this.canvasPointerUpListener);
      }
    }
  }

  public isDragging(): boolean {
    return this.isPointerDragging;
  }

  public getControls(): OrbitControls | null {
    return this.controls;
  }

  /**
   * Resets the 3D camera to the tactical overview or specified preset,
   * synchronizing OrbitControls target and camera matrix.
   */
  public resetCamera(preset: CameraPresetConfig = CAMERA_PRESETS.TACTICAL): void {
    this.applyCameraPreset(preset);
    if (this.controls) {
      this.controls.target.copy(preset.target);
      this.controls.update();
    }
    if (this.viewMode === '3d' && !this.isRunning && !this.isContextLost) {
      this.render();
    }
  }

  /**
   * Centers the 3D camera and OrbitControls target on specific terrain bounds.
   */
  public centerOnBounds(bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minElevationM?: number;
    maxElevationM?: number;
  }): void {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const spanX = Math.max(1000, bounds.maxX - bounds.minX);
    const spanY = Math.max(1000, bounds.maxY - bounds.minY);
    const midElev = ((bounds.minElevationM ?? 0) + (bounds.maxElevationM ?? 5000)) / 2;

    const aspect = Math.max(0.1, this.camera.aspect || 1.0);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const tanHalfFov = Math.tan(fovRad / 2);

    // Calculate view distance to comfortably fit both X and Y with 20% margin
    const distForY = (spanY * 0.6) / tanHalfFov;
    const distForX = (spanX * 0.6) / (tanHalfFov * aspect);
    const viewDist = Math.max(distForX, distForY, 25000);

    // Position camera south of center at ~30 deg pitch
    const pitchRad = (30 * Math.PI) / 180;
    const distY = Math.max(20000, viewDist * Math.sin(pitchRad));
    const distZ = Math.max(30000, viewDist * Math.cos(pitchRad));

    const target = new THREE.Vector3(cx, midElev, -cy);
    const position = new THREE.Vector3(cx, midElev + distY, -cy + distZ);

    this.camera.position.copy(position);
    this.camera.lookAt(target);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }
    if (this.viewMode === '3d' && !this.isRunning && !this.isContextLost) {
      this.render();
    }
  }

  public handlePointerClick(ndcX: number, ndcY: number): number | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const targets = this.tacticalEntityManager.getSelectableObjects();
    const candidateObjects: THREE.Object3D[] = targets.filter(isObjectVisibleInHierarchy);
    if (this.terrainMesh && this.terrainMesh.visible && isObjectVisibleInHierarchy(this.terrainMesh)) {
      candidateObjects.push(this.terrainMesh);
    }

    const hits = this.raycaster.intersectObjects(candidateObjects, false);
    if (hits.length === 0) return null;

    // Find nearest target hit that is visible in hierarchy and represents ACN or terminal
    const nearestTargetHit = hits.find(
      (h) =>
        isObjectVisibleInHierarchy(h.object) &&
        (typeof h.object.userData?.nodeId === 'number' || h.object.userData?.isAcn === true)
    );
    if (!nearestTargetHit) {
      // Ray intersected terrain or non-terminal objects; never select terrain
      return null;
    }

    const nearestTerrainHit = hits.find((h) => h.object === this.terrainMesh);
    if (nearestTerrainHit && nearestTerrainHit.distance < nearestTargetHit.distance) {
      // Intervening mountain ridge is closer to camera along ray -> terminal is occluded
      return null;
    }

    // ACN selection
    if (
      nearestTargetHit.object.userData?.isAcn === true ||
      nearestTargetHit.object.userData?.nodeId === -1
    ) {
      this.tacticalEntityManager.triggerNodeSelected(-1);
      return -1;
    }

    const nodeId = nearestTargetHit.object.userData?.nodeId;
    if (typeof nodeId === 'number' && nodeId >= 0 && nodeId < 16) {
      if (this.tacticalEntityManager.isNodeContactOccluded(nodeId)) {
        return null;
      }
      this.tacticalEntityManager.triggerNodeSelected(nodeId);
      return nodeId;
    }
    return null;
  }

  /**
   * Ingests 50 Hz frame telemetry from worker and updates all 3D tactical entities
   */
  public updateTelemetry(frame: any): void {
    this.tacticalEntityManager.updateFromTelemetry(frame);
    if (this.viewMode === '3d' && !this.isRunning && !this.isContextLost) {
      this.render();
    }
  }

  public setSelectedNode(nodeId: number): void {
    this.tacticalEntityManager.setSelectedNode(nodeId);
    if (this.viewMode === '3d' && !this.isRunning && !this.isContextLost) {
      this.render();
    }
  }

  public onNodeSelected(callback: (nodeId: number) => void): void {
    this.tacticalEntityManager.onNodeSelected(callback);
  }

  /**
   * Handles container resize and adjusts camera aspect and WebGL viewport
   */
  public handleResize(width?: number, height?: number): void {
    const w = width ?? this.container.clientWidth;
    const h = height ?? this.container.clientHeight;

    if (w <= 0 || h <= 0) return;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);

    // If active in 3D, trigger a render frame immediately
    if (this.viewMode === '3d' && !this.isRunning && !this.isContextLost) {
      this.render();
    }
  }

  /**
   * Switches view between '2d' and '3d'.
   * When switching to '2d', Three.js render loop is stopped completely (0% CPU/GPU overhead).
   * When switching to '3d', container is unhidden, resized, and render loop starts cleanly without duplicates.
   */
  public setViewMode(mode: StageViewMode): void {
    if (this.viewMode === mode) return;

    this.viewMode = mode;

    if (mode === '3d') {
      this.container.style.display = 'block';
      this.container.setAttribute('aria-hidden', 'false');
      if (this.controls) {
        this.controls.enabled = true;
      }
      this.handleResize();
      this.startAnimationLoop();
    } else {
      if (this.controls) {
        this.controls.enabled = false;
      }
      this.stopAnimationLoop();
      this.container.style.display = 'none';
      this.container.setAttribute('aria-hidden', 'true');
    }
  }

  public getViewMode(): StageViewMode {
    return this.viewMode;
  }

  /**
   * Starts the single authoritative animation loop.
   * Guarantees no duplicate RAF loops can run simultaneously.
   */
  public startAnimationLoop(): void {
    if (this.isRunning || this.isContextLost) return;

    this.isRunning = true;
    this.lastFrameTimestampMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.lastFpsCalcTimestampMs = this.lastFrameTimestampMs;
    this.frameCount = 0;

    const tick = (timestampMs: number) => {
      if (!this.isRunning) {
        this.rafId = null;
        return;
      }

      this.currentFrameTimeMs = timestampMs - this.lastFrameTimestampMs;
      this.lastFrameTimestampMs = timestampMs;

      // Track FPS rolling calculation
      this.frameCount++;
      const timeSinceLastFps = timestampMs - this.lastFpsCalcTimestampMs;
      if (timeSinceLastFps >= 1000) {
        this.currentFps = Math.round((this.frameCount * 1000.0) / timeSinceLastFps);
        this.frameCount = 0;
        this.lastFpsCalcTimestampMs = timestampMs;
      }

      // Update interactive camera controls with damping
      if (this.controls && this.controls.enabled) {
        this.controls.update();
      }

      // Execute render
      this.render();

      // Schedule next frame
      if (typeof requestAnimationFrame !== 'undefined') {
        this.rafId = requestAnimationFrame(tick);
      }
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(tick);
    }
  }

  /**
   * Stops the animation loop completely, eliminating idle CPU and GPU load.
   */
  public stopAnimationLoop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
  }

  /**
   * Executes a single render pass
   */
  public render(): void {
    if (this.isContextLost) return;
    const w = Math.max(10, this.container.clientWidth || 800);
    const h = Math.max(10, this.container.clientHeight || 600);
    if (this.tacticalEntityManager) {
      this.tacticalEntityManager.updateLOD(this.camera, w, h, this.terrainMesh ?? undefined);
    }
    this.renderer.render(this.scene, this.camera);
    this.totalRenderCount++;
  }

  /**
   * Telemetry and performance metrics
   */
  public getMetrics(): ThreeSceneMetrics {
    return {
      fps: this.currentFps,
      frameTimeMs: this.currentFrameTimeMs,
      renderCount: this.totalRenderCount,
      isRunning: this.isRunning,
      isContextLost: this.isContextLost,
      viewMode: this.viewMode,
      terrainResolution: this.terrainResolution,
      terrainVertexCount: this.terrainMesh?.geometry.getAttribute('position')?.count ?? 0,
      terrainTriangleCount: this.terrainMesh?.geometry.getIndex()
        ? this.terrainMesh.geometry.getIndex()!.count / 3
        : 0,
      drawCalls: this.renderer?.info?.render?.calls ?? 0,
      entityCount: 17, // 1 ACN + 16 Ground Terminals
    };
  }

  /**
   * Ingests DEM mesh data from the worker, caches it, and constructs 3D terrain geometry.
   * Cached statically; does NOT re-allocate on per-frame telemetry.
   */
  public loadTerrainMeshData(data: TerrainMeshDataPayload): void {
    this.cachedTerrainData = data;
    this.rebuildTerrain();
  }

  public setTerrainResolution(resolution: TerrainMeshResolution): void {
    if (this.terrainResolution === resolution) return;
    this.terrainResolution = resolution;
    if (this.cachedTerrainData) {
      this.rebuildTerrain();
    }
  }

  public getTerrainResolution(): TerrainMeshResolution {
    return this.terrainResolution;
  }

  public getCachedTerrainData(): TerrainMeshDataPayload | null {
    return this.cachedTerrainData;
  }

  public getTerrainMesh(): THREE.Mesh | null {
    return this.terrainMesh;
  }

  /**
   * Applies the authentic hillshade raster from the worker onto the 3D terrain surface.
   */
  public setHillshadeCanvas(canvas: HTMLCanvasElement): void {
    if (!canvas) return;
    if (this.hillshadeTexture) {
      this.hillshadeTexture.dispose();
      this.hillshadeTexture = null;
    }

    try {
      this.hillshadeTexture = new THREE.CanvasTexture(canvas);
      this.hillshadeTexture.colorSpace = THREE.SRGBColorSpace;
      this.hillshadeTexture.magFilter = THREE.LinearFilter;
      this.hillshadeTexture.minFilter = THREE.LinearMipmapLinearFilter;
      this.hillshadeTexture.generateMipmaps = true;

      if (this.terrainMesh && this.terrainMesh.material instanceof THREE.MeshStandardMaterial) {
        this.terrainMesh.material.map = this.hillshadeTexture;
        this.terrainMesh.material.color.setHex(0xffffff);
        this.terrainMesh.material.needsUpdate = true;
      }
    } catch (err) {
      console.warn('[ThreeSceneManager] Failed to bind hillshade texture to 3D terrain:', err);
    }
  }

  /**
   * Safely disposes active terrain geometry, skirts, and datum grids without touching other scene objects.
   */
  public disposeTerrain(): void {
    if (this.terrainMesh) {
      this.worldGroup.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      if (this.terrainMesh.material instanceof THREE.Material) {
        this.terrainMesh.material.dispose();
      }
      this.terrainMesh = null;
    }

    if (this.skirtMesh) {
      this.worldGroup.remove(this.skirtMesh);
      this.skirtMesh.geometry.dispose();
      if (this.skirtMesh.material instanceof THREE.Material) {
        this.skirtMesh.material.dispose();
      }
      this.skirtMesh = null;
    }

    if (this.datumGrid) {
      this.worldGroup.remove(this.datumGrid);
      this.datumGrid.traverse((obj) => {
        if (obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) {
            obj.material.dispose();
          }
        }
      });
      this.datumGrid = null;
    }

    if (this.tacticalEntityManager) {
      this.tacticalEntityManager.invalidateOcclusionCache();
    }
  }

  /**
   * Reconstructs 3D terrain mesh, perimeter skirts, and datum grid from cached data.
   */
  private rebuildTerrain(): void {
    if (!this.cachedTerrainData) return;

    this.disposeTerrain();

    // Hide M6.2.1 placeholder group now that authentic terrain is loaded
    this.placeholderGroup.visible = false;

    // 1. Build terrain geometry set (native 512 or balanced 256)
    const set = buildTerrainGeometrySet(this.cachedTerrainData, this.terrainResolution);

    // 2. Terrain mesh material with authentic shading
    const terrainMaterial = new THREE.MeshStandardMaterial({
      map: this.hillshadeTexture || null,
      color: this.hillshadeTexture ? 0xffffff : 0x1e293b,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: false,
    });

    this.terrainMesh = new THREE.Mesh(set.meshGeometry, terrainMaterial);
    this.terrainMesh.name = `terrainMesh_${this.terrainResolution}`;
    this.worldGroup.add(this.terrainMesh);

    // 3. Perimeter skirts (real DEM only down to 1,700m MSL)
    if (set.skirtGeometry) {
      const skirtMaterial = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.95,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });

      this.skirtMesh = new THREE.Mesh(set.skirtGeometry, skirtMaterial);
      this.skirtMesh.name = `terrainSkirt_${this.terrainResolution}`;
      this.worldGroup.add(this.skirtMesh);
    }

    // 4. Abstract tactical datum grid covering 1,200 km theater
    this.datumGrid = buildTacticalDatumGrid(
      APPROVED_SKIRT_BASE_MSL_M,
      600000.0,
      this.cachedTerrainData.bounds
    );
    this.worldGroup.add(this.datumGrid);

    // If 3D is active, trigger an immediate render
    if (this.viewMode === '3d' && !this.isRunning && !this.isContextLost) {
      this.render();
    }
  }

  /**
   * Disposes all Three.js GPU resources, event listeners, and observers cleanly.
   */
  public dispose(): void {
    this.stopAnimationLoop();
    this.disposeTerrain();

    if (this.controls) {
      this.controls.dispose();
      (this.controls as any) = null;
    }

    const doc = this.canvas?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc && typeof doc.removeEventListener === 'function') {
      if (this.canvasPointerMoveListener) {
        doc.removeEventListener('pointermove', this.canvasPointerMoveListener);
        doc.removeEventListener('mousemove', this.canvasPointerMoveListener);
      }
      if (this.canvasPointerUpListener) {
        doc.removeEventListener('pointerup', this.canvasPointerUpListener);
        doc.removeEventListener('mouseup', this.canvasPointerUpListener);
      }
    }

    if (this.canvas && typeof this.canvas.removeEventListener === 'function') {
      if (this.canvasClickListener) {
        this.canvas.removeEventListener('click', this.canvasClickListener);
        this.canvasClickListener = null;
      }
      if (this.canvasPointerDownListener) {
        this.canvas.removeEventListener('pointerdown', this.canvasPointerDownListener);
        this.canvas.removeEventListener('mousedown', this.canvasPointerDownListener);
        this.canvasPointerDownListener = null;
      }
      if (this.canvasPointerMoveListener) {
        this.canvas.removeEventListener('pointermove', this.canvasPointerMoveListener);
        this.canvas.removeEventListener('mousemove', this.canvasPointerMoveListener);
        this.canvasPointerMoveListener = null;
      }
      if (this.canvasPointerUpListener) {
        this.canvas.removeEventListener('pointerup', this.canvasPointerUpListener);
        this.canvas.removeEventListener('mouseup', this.canvasPointerUpListener);
        this.canvasPointerUpListener = null;
      }
      if (this.canvasWheelListener) {
        this.canvas.removeEventListener('wheel', this.canvasWheelListener);
        this.canvasWheelListener = null;
      }
    }

    if (this.tacticalEntityManager) {
      this.tacticalEntityManager.dispose();
    }

    if (this.hillshadeTexture) {
      this.hillshadeTexture.dispose();
      this.hillshadeTexture = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.windowResizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.windowResizeListener);
      this.windowResizeListener = null;
    }

    // Traverse and dispose geometries, materials, and textures
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments || object instanceof THREE.Points)) {
        return;
      }

      if (object.geometry) {
        object.geometry.dispose();
      }

      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((mat) => mat.dispose());
        } else {
          object.material.dispose();
        }
      }
    });

    this.renderer.dispose();
    if (this.canvas.parentElement && !this.container.contains(this.canvas)) {
      this.canvas.remove();
    }
  }
}

