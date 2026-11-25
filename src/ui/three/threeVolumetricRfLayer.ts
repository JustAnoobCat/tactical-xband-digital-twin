/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Three.js GPU-Light Volumetric RF Visualization Layer (M6.2.3 / V3-07)
 *
 * Implements GPU-light, zero-allocation volumetric RF visualizer:
 * 1. 3D Fresnel Clearance Ellipsoids (0.6 F1 knife-edge boundary) for active links
 * 2. 3D Banking Quad-Sector Antenna Lobes reflecting authentic UAV attitude
 * 3. 3D Threat Volumes (EW Jammer Dome & Convective Weather Cylinders)
 *
 * Invariants:
 * - Shared unit geometries (Sphere, Cone, Cylinder) pre-allocated once.
 * - Zero new BufferGeometry() or new Material() inside update().
 * - Reusable scratch vectors, matrices, and quaternions for matrix calculations.
 * - Full clean lifecycle via dispose().
 */

import * as THREE from 'three';
import { simToThreeCoords, VolumetricRfOptions, VolumetricRfState } from './threeTypes';
import { CanvasCvdMode } from '../canvasTheme';
import type { NodeTelemetryItem, TelemetryFrame } from '../../shared/workerProtocol';
import { MAX_ACTIVE_GROUND_NODES } from '../../shared/constants';
import {
  computeFresnelEllipsoidTransform,
  computeQuadSectorLobeTransforms,
  computeThreatAndWeatherVolumes,
  resolveFresnelStatusColor,
  DEFAULT_FRESNEL_CLEARANCE_FRACTION,
  DEFAULT_FRESNEL_VISUAL_SCALE,
  type Vector3Tuple,
} from './threeVolumetricRfMath';

export const MAX_PREALLOCATED_ELLIPSOIDS = 16;
export const MAX_PREALLOCATED_WEATHER_CELLS = 4;

export const SECTOR_BASE_COLORS = [
  0x38bdf8, // S0 FWD: Cyan
  0xf59e0b, // S1 STBD: Amber
  0x3b82f6, // S2 AFT: Blue
  0xa855f7, // S3 PORT: Purple
] as const;

export interface VolumetricRfUpdateContext {
  readonly selectedNodeId?: number | null;
  readonly cvdMode?: CanvasCvdMode;
}

export class ThreeVolumetricRfLayer {
  public readonly rootGroup: THREE.Group;
  public readonly fresnelGroup: THREE.Group;
  public readonly sectorLobeGroup: THREE.Group;
  public readonly volumeGroup: THREE.Group;

  // Options state
  private options: VolumetricRfOptions = {
    showFresnel: true,
    showSectorLobes: true,
    showThreatVolumes: true,
    fresnelVisualScale: DEFAULT_FRESNEL_VISUAL_SCALE,
    clearanceThreshold: DEFAULT_FRESNEL_CLEARANCE_FRACTION,
  };

  // Shared Unit Geometries
  private readonly sharedSphereGeo: THREE.SphereGeometry;
  private readonly sharedConeGeo: THREE.ConeGeometry;
  private readonly sharedDomeGeo: THREE.SphereGeometry;
  private readonly sharedCylinderGeo: THREE.CylinderGeometry;

  // Pre-allocated Mesh Pools
  private readonly ellipsoidMeshes: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly sectorLobeMeshes: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>[] = [];
  private jammerDomeMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null;
  private readonly weatherCellMeshes: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] = [];

  // Scratch objects for zero-allocation per-frame transform updates
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchVecC = new THREE.Vector3();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchAcnSim = new THREE.Vector3();
  private readonly scratchNodeSim = new THREE.Vector3();
  private readonly scratchWeatherList: Array<{
    id: string | number;
    centerWorld: Vector3Tuple;
    radiusM: number;
    heightM?: number;
    rainRateMmH?: number;
    active?: boolean;
  }> = [];

  // Active counts for metrics
  private activeEllipsoidCount: number = 0;
  private activeLobeCount: number = 0;
  private activeThreatVolumeCount: number = 0;

  constructor(initialOptions?: Partial<VolumetricRfOptions>) {
    if (initialOptions) {
      this.options = { ...this.options, ...initialOptions };
    }

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'threeVolumetricRfLayer';

    this.fresnelGroup = new THREE.Group();
    this.fresnelGroup.name = 'fresnelEllipsoidGroup';
    this.rootGroup.add(this.fresnelGroup);

    this.sectorLobeGroup = new THREE.Group();
    this.sectorLobeGroup.name = 'sectorLobeGroup';
    this.rootGroup.add(this.sectorLobeGroup);

    this.volumeGroup = new THREE.Group();
    this.volumeGroup.name = 'volumeThreatGroup';
    this.rootGroup.add(this.volumeGroup);

    // 1. Initialize Shared Unit Geometries
    // Unit Sphere: radius 1.0, centered at origin
    this.sharedSphereGeo = new THREE.SphereGeometry(1.0, 16, 12);

    // Unit Cone: radius 1.0, height 1.0
    // Rotate and translate so apex is at (0, 0, 0) and points along +Y
    this.sharedConeGeo = new THREE.ConeGeometry(1.0, 1.0, 16);
    this.sharedConeGeo.translate(0, -0.5, 0); // Apex now at (0, 0, 0), base at (0, -1, 0)
    this.sharedConeGeo.rotateX(Math.PI);     // Apex at (0, 0, 0), base at (0, +1, 0)

    // Unit Upper Hemisphere Dome for Jammer: radius 1.0, height 1.0
    this.sharedDomeGeo = new THREE.SphereGeometry(1.0, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);

    // Unit Cylinder for Weather Cells: radius 1.0, height 1.0
    // Translate so bottom base is at y = 0
    this.sharedCylinderGeo = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 24);
    this.sharedCylinderGeo.translate(0, 0.5, 0);

    // 2. Pre-allocate 16 Link Fresnel Ellipsoids (grows on demand up to MAX_ACTIVE_GROUND_NODES)
    for (let i = 0; i < MAX_PREALLOCATED_ELLIPSOIDS; i++) {
      this.allocateEllipsoidMesh(i);
    }

    // 3. Pre-allocate 4 Quad-Sector Lobes (S0, S1, S2, S3)
    for (let s = 0; s < 4; s++) {
      const mat = new THREE.MeshBasicMaterial({
        color: SECTOR_BASE_COLORS[s],
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.sharedConeGeo, mat);
      mesh.name = `sectorLobeCone_${s}`;
      mesh.visible = false;
      this.sectorLobeMeshes.push(mesh);
      this.sectorLobeGroup.add(mesh);
    }

    // 4. Pre-allocate EW Jammer Threat Dome
    const jammerMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.jammerDomeMesh = new THREE.Mesh(this.sharedDomeGeo, jammerMat);
    this.jammerDomeMesh.name = 'jammerThreatDomeMesh';
    this.jammerDomeMesh.visible = false;
    this.volumeGroup.add(this.jammerDomeMesh);

    // 5. Pre-allocate 4 Convective Weather Cell Cylinders
    for (let w = 0; w < MAX_PREALLOCATED_WEATHER_CELLS; w++) {
      this.allocateWeatherCellMesh(w);
    }
  }

  private allocateEllipsoidMesh(index: number): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.sharedSphereGeo, mat);
    mesh.name = `fresnelEllipsoid_${index}`;
    mesh.visible = false;
    this.ellipsoidMeshes.push(mesh);
    this.fresnelGroup.add(mesh);
    return mesh;
  }

  private allocateWeatherCellMesh(index: number): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> {
    const wMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.sharedCylinderGeo, wMat);
    mesh.name = `weatherCellCylinder_${index}`;
    mesh.visible = false;
    this.weatherCellMeshes.push(mesh);
    this.volumeGroup.add(mesh);
    return mesh;
  }

  public setOptions(options: Partial<VolumetricRfOptions>): void {
    this.options = { ...this.options, ...options };
    if (this.options.showFresnel === false) {
      for (const m of this.ellipsoidMeshes) m.visible = false;
    }
    if (this.options.showSectorLobes === false) {
      for (const m of this.sectorLobeMeshes) m.visible = false;
    }
    if (this.options.showThreatVolumes === false) {
      if (this.jammerDomeMesh) this.jammerDomeMesh.visible = false;
      for (const m of this.weatherCellMeshes) m.visible = false;
    }
  }

  public getOptions(): VolumetricRfOptions {
    return { ...this.options };
  }

  public getState(): VolumetricRfState {
    return {
      showFresnel: Boolean(this.options.showFresnel),
      showSectorLobes: Boolean(this.options.showSectorLobes),
      showThreatVolumes: Boolean(this.options.showThreatVolumes),
      activeEllipsoidCount: this.activeEllipsoidCount,
      activeLobeCount: this.activeLobeCount,
      activeThreatVolumeCount: this.activeThreatVolumeCount,
    };
  }

  /**
   * Updates all volumetric RF geometries in-place based on frame telemetry.
   * Allocates ZERO new Three.js geometries or materials in steady state.
   */
  public update(frame: TelemetryFrame | null | undefined, context?: VolumetricRfUpdateContext): void {
    if (!frame) return;

    // Reset active metrics
    this.activeEllipsoidCount = 0;
    this.activeLobeCount = 0;
    this.activeThreatVolumeCount = 0;

    // 1. Extract authoritative ACN position from canonical TelemetryFrame.acn_telemetry
    const acnTel = frame.acn_telemetry;
    const acnX = acnTel && Number.isFinite(acnTel.pos_x) ? acnTel.pos_x : 0;
    const acnY = acnTel && Number.isFinite(acnTel.pos_y) ? acnTel.pos_y : 0;
    const acnZ = acnTel && Number.isFinite(acnTel.pos_z) ? acnTel.pos_z : 5000;

    this.scratchAcnSim.set(acnX, acnY, acnZ);
    // Sim coordinates (X, Y, Z_msl) to Three root coordinates (X, Y_msl, -Y)
    const acnRootPos = simToThreeCoords(this.scratchAcnSim.x, this.scratchAcnSim.y, this.scratchAcnSim.z);

    // 2. Update 3D Fresnel Ellipsoids (pre-allocated 16, grows on demand up to MAX_ACTIVE_GROUND_NODES)
    const showFresnel = this.options.showFresnel ?? true;
    const nodes: readonly NodeTelemetryItem[] = Array.isArray(frame.nodes_telemetry) ? frame.nodes_telemetry : [];
    const targetEllipsoidCount = showFresnel ? Math.min(nodes.length, MAX_ACTIVE_GROUND_NODES) : 0;

    while (this.ellipsoidMeshes.length < targetEllipsoidCount) {
      this.allocateEllipsoidMesh(this.ellipsoidMeshes.length);
    }

    for (let i = 0; i < this.ellipsoidMeshes.length; i++) {
      const mesh = this.ellipsoidMeshes[i];
      if (!showFresnel || i >= targetEllipsoidCount) {
        mesh.visible = false;
        continue;
      }

      const node = nodes[i];
      if (
        !node ||
        node.is_coverage_complete === false ||
        !Number.isFinite(node.x_m) ||
        !Number.isFinite(node.y_m) ||
        !Number.isFinite(node.z_m)
      ) {
        mesh.visible = false;
        continue;
      }

      this.scratchNodeSim.set(node.x_m, node.y_m, node.z_m);
      const nodeRootPos = simToThreeCoords(this.scratchNodeSim.x, this.scratchNodeSim.y, this.scratchNodeSim.z);

      const slantRangeM =
        Number.isFinite(node.slant_range_km) && node.slant_range_km > 0
          ? node.slant_range_km * 1000.0
          : nodeRootPos.distanceTo(acnRootPos);

      const transform = computeFresnelEllipsoidTransform({
        txWorld: [acnRootPos.x, acnRootPos.y, acnRootPos.z],
        rxWorld: [nodeRootPos.x, nodeRootPos.y, nodeRootPos.z],
        slantRangeM,
        clearanceFraction: this.options.clearanceThreshold ?? DEFAULT_FRESNEL_CLEARANCE_FRACTION,
        visualRadialScale: this.options.fresnelVisualScale ?? DEFAULT_FRESNEL_VISUAL_SCALE,
      });

      if (!transform.isValid || transform.chordLengthWorld <= 1e-3) {
        mesh.visible = false;
        continue;
      }

      // In-place transform updates
      mesh.position.set(transform.centerWorld[0], transform.centerWorld[1], transform.centerWorld[2]);
      mesh.scale.set(transform.visualRadiusWorld, transform.chordLengthWorld * 0.5, transform.visualRadiusWorld);

      this.scratchVecA.set(transform.basis.axisX[0], transform.basis.axisX[1], transform.basis.axisX[2]);
      this.scratchVecB.set(transform.basis.axisY[0], transform.basis.axisY[1], transform.basis.axisY[2]);
      this.scratchVecC.set(transform.basis.axisZ[0], transform.basis.axisZ[1], transform.basis.axisZ[2]);
      this.scratchMatrix.makeBasis(this.scratchVecA, this.scratchVecB, this.scratchVecC);
      mesh.quaternion.setFromRotationMatrix(this.scratchMatrix);

      // Color mapping strictly from canonical NodeTelemetryItem fields
      const isSelected = context?.selectedNodeId === node.node_id;
      const isOutage = Boolean(node.link_outage);
      const clearanceRatio =
        Number.isFinite(node.fresnel_clearance_m) && transform.physicalMidpointRadiusM > 0
          ? node.fresnel_clearance_m / transform.physicalMidpointRadiusM
          : (isOutage ? 0.0 : 1.0);

      const colorRes = resolveFresnelStatusColor(isOutage, clearanceRatio, isSelected, context?.cvdMode);
      mesh.material.color.setHex(colorRes.hex);
      mesh.material.opacity = isSelected ? 0.35 : 0.20;
      mesh.visible = true;
      this.activeEllipsoidCount++;
    }

    // 3. Update 3D Banking Quad-Sector Lobes
    const showLobes = this.options.showSectorLobes ?? true;
    if (!showLobes) {
      for (const m of this.sectorLobeMeshes) m.visible = false;
    } else {
      const headingDeg =
        typeof frame.acn_heading_deg === 'number' && Number.isFinite(frame.acn_heading_deg)
          ? frame.acn_heading_deg
          : typeof acnTel?.heading_deg === 'number' && Number.isFinite(acnTel.heading_deg)
            ? acnTel.heading_deg
            : acnTel && Number.isFinite(acnTel.heading_rad)
              ? (((90.0 - (acnTel.heading_rad * 180.0) / Math.PI) % 360.0) + 360.0) % 360.0
              : 0.0;
      const pitchDeg =
        typeof acnTel?.pitch_deg === 'number' && Number.isFinite(acnTel.pitch_deg)
          ? acnTel.pitch_deg
          : typeof frame.hifi_telemetry?.uav_pitch_deg === 'number' && Number.isFinite(frame.hifi_telemetry.uav_pitch_deg)
            ? frame.hifi_telemetry.uav_pitch_deg
            : 0.0;
      const rollDeg =
        typeof frame.acn_bank_deg === 'number' && Number.isFinite(frame.acn_bank_deg)
          ? frame.acn_bank_deg
          : typeof acnTel?.bank_deg === 'number' && Number.isFinite(acnTel.bank_deg)
            ? acnTel.bank_deg
            : typeof frame.hifi_telemetry?.uav_roll_deg === 'number' && Number.isFinite(frame.hifi_telemetry.uav_roll_deg)
              ? frame.hifi_telemetry.uav_roll_deg
              : 0.0;

      const targetNodeId = context?.selectedNodeId ?? frame.selected_node_id;
      let activeSectorId = 0;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]?.node_id === targetNodeId && typeof nodes[i].active_sector_id === 'number') {
          activeSectorId = nodes[i].active_sector_id!;
          break;
        }
      }

      const lobeResult = computeQuadSectorLobeTransforms({
        acnWorld: [acnRootPos.x, acnRootPos.y, acnRootPos.z],
        yawDeg: headingDeg,
        pitchDeg,
        rollDeg,
        activeSectorIndex: activeSectorId,
      });

      for (let s = 0; s < 4; s++) {
        const desc = lobeResult.lobes[s];
        const mesh = this.sectorLobeMeshes[s];

        mesh.position.set(desc.originWorld[0], desc.originWorld[1], desc.originWorld[2]);
        mesh.scale.set(desc.radiusWorld, desc.lengthWorld, desc.radiusWorld);

        this.scratchVecA.set(desc.basis.axisX[0], desc.basis.axisX[1], desc.basis.axisX[2]);
        this.scratchVecB.set(desc.basis.axisY[0], desc.basis.axisY[1], desc.basis.axisY[2]);
        this.scratchVecC.set(desc.basis.axisZ[0], desc.basis.axisZ[1], desc.basis.axisZ[2]);
        this.scratchMatrix.makeBasis(this.scratchVecA, this.scratchVecB, this.scratchVecC);
        mesh.quaternion.setFromRotationMatrix(this.scratchMatrix);

        mesh.material.opacity = desc.isActive ? 0.28 : 0.08;
        mesh.visible = true;
        this.activeLobeCount++;
      }
    }

    // 4. Update 3D Threat & Weather Volumes
    const showVolumes = this.options.showThreatVolumes ?? true;
    if (!showVolumes) {
      if (this.jammerDomeMesh) this.jammerDomeMesh.visible = false;
      for (const m of this.weatherCellMeshes) m.visible = false;
    } else {
      // EW Jammer from canonical TelemetryFrame fields
      let jammerCenterRoot: Vector3Tuple | null = null;
      let jammerActive = false;
      let jammerPowerDbm: number | undefined;

      if (frame.jammer_enabled && Array.isArray(frame.jammer_pos_enu) && frame.jammer_pos_enu.length >= 2) {
        const p = frame.jammer_pos_enu;
        if (Number.isFinite(p[0]) && Number.isFinite(p[1])) {
          const jRoot = simToThreeCoords(p[0], p[1], Number.isFinite(p[2]) ? p[2] : 0);
          jammerCenterRoot = [jRoot.x, jRoot.y, jRoot.z];
          jammerActive = true;
          jammerPowerDbm = typeof frame.jammer_eirp_dbm === 'number' && Number.isFinite(frame.jammer_eirp_dbm)
            ? frame.jammer_eirp_dbm
            : undefined;
        }
      }

      // Weather cells from canonical TelemetryFrame.weather_cells
      this.scratchWeatherList.length = 0;
      if (Array.isArray(frame.weather_cells) && frame.weather_cells.length > 0) {
        const cellCount = Math.min(frame.weather_cells.length, MAX_ACTIVE_GROUND_NODES);
        for (let i = 0; i < cellCount; i++) {
          const wc = frame.weather_cells[i];
          if (!wc || !Number.isFinite(wc.center_x_m) || !Number.isFinite(wc.center_y_m)) continue;
          const wRoot = simToThreeCoords(wc.center_x_m, wc.center_y_m, 0);
          this.scratchWeatherList.push({
            id: wc.id,
            centerWorld: [wRoot.x, wRoot.y, wRoot.z],
            radiusM: Number.isFinite(wc.radius_m) && wc.radius_m > 0 ? wc.radius_m : 5000,
            heightM: 6000,
            rainRateMmH: Number.isFinite(wc.peak_rain_mmh) ? wc.peak_rain_mmh : 0,
            active: true,
          });
        }
      }

      const threatData = computeThreatAndWeatherVolumes({
        jammer: jammerCenterRoot
          ? { active: jammerActive, centerWorld: jammerCenterRoot, powerDbm: jammerPowerDbm }
          : undefined,
        weatherCells: this.scratchWeatherList,
      });

      if (this.jammerDomeMesh) {
        if (threatData.jammerDome && threatData.jammerDome.active) {
          this.jammerDomeMesh.position.set(
            threatData.jammerDome.centerWorld[0],
            threatData.jammerDome.centerWorld[1],
            threatData.jammerDome.centerWorld[2]
          );
          this.jammerDomeMesh.scale.set(
            threatData.jammerDome.radiusWorld,
            threatData.jammerDome.heightWorld,
            threatData.jammerDome.radiusWorld
          );
          this.jammerDomeMesh.material.opacity = threatData.jammerDome.opacity;
          this.jammerDomeMesh.visible = true;
          this.activeThreatVolumeCount++;
        } else {
          this.jammerDomeMesh.visible = false;
        }
      }

      while (this.weatherCellMeshes.length < threatData.weatherCells.length) {
        this.allocateWeatherCellMesh(this.weatherCellMeshes.length);
      }

      for (let w = 0; w < this.weatherCellMeshes.length; w++) {
        const mesh = this.weatherCellMeshes[w];
        if (w < threatData.weatherCells.length && threatData.weatherCells[w].active) {
          const wc = threatData.weatherCells[w];
          mesh.position.set(wc.centerWorld[0], wc.centerWorld[1], wc.centerWorld[2]);
          mesh.scale.set(wc.radiusWorld, wc.heightWorld, wc.radiusWorld);
          mesh.material.opacity = wc.opacity;
          mesh.visible = true;
          this.activeThreatVolumeCount++;
        } else {
          mesh.visible = false;
        }
      }
    }
  }

  /**
   * Frees all GPU resources cleanly.
   */
  public dispose(): void {
    // 1. Dispose shared unit geometries
    this.sharedSphereGeo.dispose();
    this.sharedConeGeo.dispose();
    this.sharedDomeGeo.dispose();
    this.sharedCylinderGeo.dispose();

    // 2. Dispose meshes & materials
    for (const m of this.ellipsoidMeshes) {
      m.material.dispose();
    }
    this.ellipsoidMeshes.length = 0;

    for (const m of this.sectorLobeMeshes) {
      m.material.dispose();
    }
    this.sectorLobeMeshes.length = 0;

    if (this.jammerDomeMesh) {
      this.jammerDomeMesh.material.dispose();
      this.jammerDomeMesh = null;
    }

    for (const m of this.weatherCellMeshes) {
      m.material.dispose();
    }
    this.weatherCellMeshes.length = 0;

    // 3. Clear groups
    this.fresnelGroup.clear();
    this.sectorLobeGroup.clear();
    this.volumeGroup.clear();
    this.rootGroup.clear();
  }
}
