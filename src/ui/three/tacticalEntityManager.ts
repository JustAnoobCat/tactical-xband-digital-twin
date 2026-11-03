/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Tactical 3D Entities, Trajectories & Communication Links Manager (M6.2.3 / M6.2.3-B)
 *
 * Implements authoritative visualization of tactical entities inside worldGroup:
 *   - Simulation frame: +X East, +Y North, +Z MSL Altitude (m).
 *   - ACN tactical aircraft with authoritative heading and geometric altitude (5,000m MSL).
 *   - 16 ground terminals with clear MCP vs Soldier distinction.
 *   - Verified handling of unmapped nodes (zero altitude fabrication).
 *   - Worker-provided flight path visualization using dynamic geometry buffers.
 *   - 16 communication links with all 6 link status styles from MAP_LINK_STYLES.
 *   - Authenticated bulk-transfer packet animation only (general TDMA disabled).
 *   - M6.2.3-B: Screen-space tactical markers (sizeAttenuation: false), projected-size LOD,
 *     authoritative camera-projected ACN heading, prioritized label decluttering,
 *     and terrain-occluded screen-space raycast selection.
 */

import * as THREE from 'three';
import {
  classifyLinkCommunicationStatus,
  LinkCommunicationStatus,
} from '../../core/linkStatusClassifier';
import { MAP_LINK_STYLES } from '../mapLinkStyles';

/**
 * Assumed physical dimensions for tactical equipment (strictly 1x scale).
 * These are engineering approximations for visualization, not certified manufacturer specs.
 */
export const ASSUMED_PHYSICAL_DIMENSIONS = Object.freeze({
  acn: {
    wingspanM: 14.0,
    fuselageLengthM: 9.0,
    fuselageDiameterM: 1.6,
    stabilizerHeightM: 2.5,
  },
  soldierTerminal: {
    mastHeightM: 2.0,   // Standard soldier AGL
    tripodBaseRadiusM: 0.6,
  },
  mcpTerminal: {
    mastHeightM: 10.0,  // Standard MCP AGL
    dishDiameterM: 2.4,
    shelterLengthM: 6.0,
    shelterWidthM: 2.5,
    shelterHeightM: 2.5,
  },
});

/**
 * 1x physical scale factors (enforced by M6.2.3-B specification).
 */
export const VISUAL_MARKER_SCALE = Object.freeze({
  acn: 1.0,
  soldier: 1.0,
  mcp: 1.0,
  hitTargetRadiusM: 350.0,
});

/**
 * Tactical screen-space marker target footprints (in CSS pixels).
 */
export const TACTICAL_MARKER_TARGET_PIXELS = Object.freeze({
  acn: 32.0,
  mcp: 24.0,
  soldier: 18.0,
  reticle: 32.0,
  callsignWidth: 56.0,
  callsignHeight: 20.0,
  soldierAnchorLiftM: 15.0,
  mcpAnchorLiftM: 25.0,
});

export interface GroundNodeItem {
  readonly nodeId: number;
  readonly isMcp: boolean;
  readonly group: THREE.Group;
  readonly visualGroup: THREE.Group;        // Physical 1x 3D model
  readonly markerMesh: THREE.Mesh;          // Physical marker mesh reference
  readonly markerAnchorGroup: THREE.Group;  // Anchor lifted above terrain
  readonly markerSprite: THREE.Sprite;      // Screen-space tactical status marker
  readonly markerPlumbLine: THREE.Line;     // Plumb line connecting marker to ground
  readonly selectionReticle: THREE.Sprite;  // Screen-space corner-bracket reticle
  readonly unmappedIndicator: THREE.Group;  // Schematic indicator for out-of-coverage
  readonly callsignSprite: THREE.Sprite;    // Screen-space callsign badge
  hitTarget: THREE.Object3D;                // Active selection target (markerSprite or visual model)
  lastZ: number;
  isMapped: boolean;
  status: LinkCommunicationStatus;
}

/**
 * Validates that an object and all of its ancestor groups are currently visible.
 */
export function isObjectVisibleInHierarchy(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}

// ----------------------------------------------------------------------------
// Canvas Helper & Texture Generation
// ----------------------------------------------------------------------------

function createTacticalCanvas(w: number, h: number): HTMLCanvasElement | any {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }
  // Headless Node.js / SSR mock fallback
  return {
    width: w,
    height: h,
    getContext: (type: string) => {
      if (type === '2d') {
        return new Proxy({}, { get: () => (..._args: any[]) => ({}) });
      }
      return null;
    },
  };
}

function createAcnChevronTexture(): THREE.CanvasTexture {
  const canvas = createTacticalCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);

    // Outer tactical surveillance ring
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Directional chevron apex notch on ring
    ctx.beginPath();
    ctx.moveTo(64, 6);
    ctx.lineTo(60, 14);
    ctx.lineTo(68, 14);
    ctx.closePath();
    ctx.fillStyle = '#38bdf8';
    ctx.fill();

    // Symmetrical aircraft silhouette / delta chevron pointing UP (+Y)
    ctx.beginPath();
    ctx.moveTo(64, 16);          // Nose apex
    ctx.lineTo(110, 88);         // Right wingtip
    ctx.lineTo(88, 96);          // Right trailing notch
    ctx.lineTo(64, 76);          // Fuselage keel
    ctx.lineTo(40, 96);          // Left trailing notch
    ctx.lineTo(18, 88);          // Left wingtip
    ctx.closePath();
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Center cockpit core pip
    ctx.beginPath();
    ctx.arc(64, 46, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMcpCommandTexture(): THREE.CanvasTexture {
  const canvas = createTacticalCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);

    // Outer diamond command base
    ctx.beginPath();
    ctx.moveTo(64, 14);
    ctx.lineTo(114, 64);
    ctx.lineTo(64, 114);
    ctx.lineTo(14, 64);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8, 12, 16, 0.88)';
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Inner diamond border
    ctx.beginPath();
    ctx.moveTo(64, 24);
    ctx.lineTo(104, 64);
    ctx.lineTo(64, 104);
    ctx.lineTo(24, 64);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Center radar mast
    ctx.beginPath();
    ctx.moveTo(64, 94);
    ctx.lineTo(64, 40);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Parabolic dish symbol at top
    ctx.beginPath();
    ctx.arc(64, 40, 16, Math.PI * 0.85, Math.PI * 0.15, true);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Transmission wave pulses
    ctx.beginPath();
    ctx.arc(64, 30, 8, Math.PI * 1.1, Math.PI * 1.9);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSoldierRoundelTexture(): THREE.CanvasTexture {
  const canvas = createTacticalCanvas(96, 96);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 96, 96);

    // Dark backdrop circle to guarantee high contrast against bright mountain snow
    ctx.beginPath();
    ctx.arc(48, 48, 44, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 12, 16, 0.85)';
    ctx.fill();

    // Outer status ring (pure white so material.color tints it)
    ctx.beginPath();
    ctx.arc(48, 48, 36, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Cardinal tick marks
    const ticks = [
      [48, 4, 48, 14],
      [48, 82, 48, 92],
      [4, 48, 14, 48],
      [82, 48, 92, 48],
    ];
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of ticks) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Center core pip
    ctx.beginPath();
    ctx.arc(48, 48, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Inner dark center aperture
    ctx.beginPath();
    ctx.arc(48, 48, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 12, 16, 0.9)';
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createReticleTexture(): THREE.CanvasTexture {
  const canvas = createTacticalCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);

    // 4 corner brackets
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 5;
    ctx.lineCap = 'square';

    // Top-left
    ctx.beginPath();
    ctx.moveTo(18, 46);
    ctx.lineTo(18, 18);
    ctx.lineTo(46, 18);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(82, 18);
    ctx.lineTo(110, 18);
    ctx.lineTo(110, 46);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(110, 82);
    ctx.lineTo(110, 110);
    ctx.lineTo(82, 110);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(46, 110);
    ctx.lineTo(18, 110);
    ctx.lineTo(18, 82);
    ctx.stroke();

    // Center reticle crosshair dots
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(62, 14, 4, 8);
    ctx.fillRect(62, 106, 4, 8);
    ctx.fillRect(14, 62, 8, 4);
    ctx.fillRect(106, 62, 8, 4);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCallsignTexture(label: string, borderCss: string): THREE.CanvasTexture {
  const canvas = createTacticalCanvas(256, 96);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 96);

    // Rounded rectangle pill
    const x = 8, y = 12, w = 240, h = 72, r = 16;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fillStyle = 'rgba(8, 12, 16, 0.88)';
    ctx.fill();
    ctx.strokeStyle = borderCss;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Callsign typography
    ctx.font = 'bold 36px "IBM Plex Mono", monospace';
    ctx.fillStyle = borderCss;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 48);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ----------------------------------------------------------------------------
// TacticalEntityManager Class
// ----------------------------------------------------------------------------

export class TacticalEntityManager {
  public readonly rootGroup: THREE.Group;

  // Sub-groups inside worldGroup
  public readonly acnGroup: THREE.Group;
  public readonly trajectoryGroup: THREE.Group;
  public readonly groundNodesGroup: THREE.Group;
  public readonly linksGroup: THREE.Group;
  public readonly trafficGroup: THREE.Group;

  // ACN Components
  private acnVisualGroup!: THREE.Group;         // Physical 1x model
  private acnMarkerSprite!: THREE.Sprite;       // Screen-space tactical chevron
  private acnCallsignSprite!: THREE.Sprite;     // Screen-space callsign tag
  private acnCoverageLine!: THREE.LineLoop;
  private lastValidHeadingRad: number = Math.PI / 2; // Default facing North (+Y)
  private lastScreenHeadingRad: number = 0;
  private acnAltitudeM: number = 5000.0;             // Authoritative geometric 5,000m MSL

  // Trajectory Components
  private trajectoryLine!: THREE.LineLoop;
  private trajectoryGeo!: THREE.BufferGeometry;
  private trajectoryMaxPoints: number = 256;

  // Ground Nodes (16 items)
  private nodeItems: GroundNodeItem[] = [];

  // Communication Links (16 links)
  private linkLines: THREE.Line[] = [];
  private linkGeometries: THREE.BufferGeometry[] = [];
  private linkMap: Map<number, { line: THREE.Line; geo: THREE.BufferGeometry }> = new Map();
  private materialPool: Map<string, THREE.Material> = new Map();

  // Pre-baked Canvas Textures
  private acnMarkerTexture!: THREE.CanvasTexture;
  private mcpMarkerTexture!: THREE.CanvasTexture;
  private soldierMarkerTexture!: THREE.CanvasTexture;
  private reticleTexture!: THREE.CanvasTexture;
  private callsignTextures: Map<string, THREE.CanvasTexture> = new Map();

  // Verified Bulk Transfer Animation
  private bulkPacketMesh!: THREE.Mesh;
  private lastDeliveredBytes: number = 0;
  private bulkTransferProgress: number = 0;

  // Selection state & callbacks
  private selectedNodeId: number = 4;
  private onNodeSelectedCallbacks: ((nodeId: number) => void)[] = [];

  // Scratch math buffers (zero-allocation per frame execution)
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchVecC = new THREE.Vector3();
  private readonly scratchVec2A = new THREE.Vector2();
  private readonly scratchVec2B = new THREE.Vector2();

  // Contact point terrain occlusion cache
  private readonly lastOcclusionCameraPosition = new THREE.Vector3();
  private readonly lastOcclusionCameraQuaternion = new THREE.Quaternion();
  private readonly nodeContactOccluded: boolean[] = new Array(16).fill(false);
  private occlusionTerrainMeshRef: THREE.Mesh | null = null;
  private occlusionTelemetryVersion: number = 0;
  private lastEvaluatedTelemetryVersion: number = -1;
  private readonly occlusionRaycaster = new THREE.Raycaster();

  // Pre-allocated storage for zero-allocation label decluttering
  private readonly declutterCandidates: {
    sprite: THREE.Sprite | null;
    priority: number;
    screenX: number;
    screenY: number;
    dist: number;
  }[] = Array.from({ length: 17 }, () => ({
    sprite: null,
    priority: 0,
    screenX: 0,
    screenY: 0,
    dist: 0,
  }));
  private declutterCandidateCount: number = 0;

  private readonly declutterAcceptedBoxes: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }[] = Array.from({ length: 17 }, () => ({
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  }));
  private declutterAcceptedCount: number = 0;

  constructor() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'tacticalEntitiesRoot';

    this.trajectoryGroup = new THREE.Group();
    this.trajectoryGroup.name = 'trajectoryGroup';
    this.rootGroup.add(this.trajectoryGroup);

    this.linksGroup = new THREE.Group();
    this.linksGroup.name = 'linksGroup';
    this.rootGroup.add(this.linksGroup);

    this.trafficGroup = new THREE.Group();
    this.trafficGroup.name = 'trafficGroup';
    this.rootGroup.add(this.trafficGroup);

    this.groundNodesGroup = new THREE.Group();
    this.groundNodesGroup.name = 'groundNodesGroup';
    this.rootGroup.add(this.groundNodesGroup);

    this.acnGroup = new THREE.Group();
    this.acnGroup.name = 'acnGroup';
    this.rootGroup.add(this.acnGroup);

    this.initTextures();
    this.initMaterialPool();
    this.initAcn();
    this.initTrajectory();
    this.initGroundNodes();
    this.initLinks();
    this.initBulkTransferPacket();
  }

  /**
   * Initializes pre-baked static canvas textures once at startup.
   */
  private initTextures(): void {
    this.acnMarkerTexture = createAcnChevronTexture();
    this.mcpMarkerTexture = createMcpCommandTexture();
    this.soldierMarkerTexture = createSoldierRoundelTexture();
    this.reticleTexture = createReticleTexture();

    this.callsignTextures.set('ACN', createCallsignTexture('ACN', '#38bdf8'));
    this.callsignTextures.set('MCP', createCallsignTexture('MCP', '#0284c7'));
    for (let i = 1; i < 16; i++) {
      this.callsignTextures.set(`S${i}`, createCallsignTexture(`S${i}`, '#38bdf8'));
    }
  }

  /**
   * Initializes pre-allocated material pool for all 6 link statuses.
   */
  private initMaterialPool(): void {
    const statuses: LinkCommunicationStatus[] = [
      'CONNECTED',
      'DEGRADED',
      'BLOCKED_TERRAIN',
      'BLOCKED_OBSTACLE',
      'OUTAGE_DISCONNECTED',
      'UNKNOWN',
    ];

    for (const status of statuses) {
      const style = MAP_LINK_STYLES[status];
      const strokeHex = this.parseCssColor(style.strokeColor);
      const selStrokeHex = this.parseCssColor(style.selectedStrokeColor);

      const isDashed = status !== 'CONNECTED';
      const dashSize = status === 'DEGRADED' ? 800 : (status === 'BLOCKED_OBSTACLE' ? 300 : 500);
      const gapSize = status === 'DEGRADED' ? 400 : (status === 'BLOCKED_OBSTACLE' ? 400 : 500);

      const normalMat = isDashed
        ? new THREE.LineDashedMaterial({
            color: strokeHex,
            dashSize,
            gapSize,
            transparent: true,
            opacity: status === 'OUTAGE_DISCONNECTED' || status === 'UNKNOWN' ? 0.45 : 0.85,
            linewidth: 1,
            depthTest: true,
          })
        : new THREE.LineBasicMaterial({
            color: strokeHex,
            transparent: true,
            opacity: 0.9,
            linewidth: 1,
            depthTest: true,
          });

      const selectedMat = isDashed
        ? new THREE.LineDashedMaterial({
            color: selStrokeHex,
            dashSize,
            gapSize,
            transparent: true,
            opacity: 1.0,
            linewidth: 2,
            depthTest: true,
          })
        : new THREE.LineBasicMaterial({
            color: selStrokeHex,
            transparent: true,
            opacity: 1.0,
            linewidth: 2,
            depthTest: true,
          });

      this.materialPool.set(`normal_${status}`, normalMat);
      this.materialPool.set(`selected_${status}`, selectedMat);
    }
  }

  private parseCssColor(cssColor: string): number {
    if (cssColor.startsWith('#')) {
      return parseInt(cssColor.slice(1), 16);
    }
    const match = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return (parseInt(match[1], 10) << 16) | (parseInt(match[2], 10) << 8) | parseInt(match[3], 10);
    }
    return 0x38bdf8;
  }

  /**
   * Initializes the authoritative ACN aircraft model (1x scale) and tactical chevron sprite.
   */
  private initAcn(): void {
    this.acnVisualGroup = new THREE.Group();
    this.acnVisualGroup.name = 'acnVisualGroup';

    const p = ASSUMED_PHYSICAL_DIMENSIONS.acn;

    // Physical Fuselage: authentic 1x cone geometry (9m length, 0.8m radius)
    const fuseGeo = new THREE.ConeGeometry(
      p.fuselageDiameterM * 0.5,
      p.fuselageLengthM,
      12
    );
    fuseGeo.translate(0, p.fuselageLengthM * 0.25, 0);

    const acnMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.35,
      metalness: 0.7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.45,
    });
    const fuselage = new THREE.Mesh(fuseGeo, acnMat);
    fuselage.userData = { isAcn: true, nodeId: -1 };
    this.acnVisualGroup.add(fuselage);

    // Physical Delta Wings (1x scale, 14m wingspan)
    const wingShape = new THREE.Shape();
    const halfSpan = p.wingspanM * 0.5;
    const rootChord = p.fuselageLengthM * 0.6;
    wingShape.moveTo(0, rootChord * 0.4);
    wingShape.lineTo(halfSpan, -rootChord * 0.4);
    wingShape.lineTo(halfSpan * 0.9, -rootChord * 0.6);
    wingShape.lineTo(-halfSpan * 0.9, -rootChord * 0.6);
    wingShape.lineTo(-halfSpan, -rootChord * 0.4);
    wingShape.closePath();

    const wingGeo = new THREE.ShapeGeometry(wingShape);
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.4,
      metalness: 0.6,
      side: THREE.DoubleSide,
    });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    wings.userData = { isAcn: true, nodeId: -1 };
    this.acnVisualGroup.add(wings);

    // Twin Canted Stabilizers (1x scale)
    const finGeo = new THREE.ConeGeometry(
      p.fuselageDiameterM * 0.25,
      p.stabilizerHeightM,
      4
    );
    finGeo.rotateX(Math.PI / 2);
    finGeo.rotateZ(Math.PI / 6);
    const fin1 = new THREE.Mesh(finGeo, acnMat);
    fin1.userData = { isAcn: true, nodeId: -1 };
    fin1.position.set(halfSpan * 0.25, -(rootChord * 0.35), p.stabilizerHeightM * 0.5);
    const fin2 = new THREE.Mesh(finGeo, acnMat);
    fin2.userData = { isAcn: true, nodeId: -1 };
    fin2.rotation.z = -Math.PI / 3;
    fin2.position.set(-(halfSpan * 0.25), -(rootChord * 0.35), p.stabilizerHeightM * 0.5);
    this.acnVisualGroup.add(fin1);
    this.acnVisualGroup.add(fin2);

    this.acnGroup.add(this.acnVisualGroup);

    // Screen-space tactical chevron marker (sizeAttenuation: false, target 32px)
    const acnMarkerMat = new THREE.SpriteMaterial({
      map: this.acnMarkerTexture,
      sizeAttenuation: false,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0,
      transparent: true,
      opacity: 1.0,
    });
    this.acnMarkerSprite = new THREE.Sprite(acnMarkerMat);
    this.acnMarkerSprite.name = 'acnMarkerSprite';
    this.acnMarkerSprite.userData = { isAcn: true, nodeId: -1 };
    this.acnMarkerSprite.scale.set(0.04, 0.04, 1);
    this.acnGroup.add(this.acnMarkerSprite);

    // Screen-space callsign badge ("ACN")
    const acnCallsignMat = new THREE.SpriteMaterial({
      map: this.callsignTextures.get('ACN'),
      sizeAttenuation: false,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -5.0,
      transparent: true,
      opacity: 1.0,
    });
    this.acnCallsignSprite = new THREE.Sprite(acnCallsignMat);
    this.acnCallsignSprite.name = 'acnCallsignSprite';
    this.acnCallsignSprite.scale.set(0.07, 0.025, 1);
    this.acnCallsignSprite.position.set(0, 0, 120.0);
    this.acnGroup.add(this.acnCallsignSprite);

    // Range ring (35km radius)
    const ringRadius = 35000.0;
    const ringSegments = 96;
    const ringPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= ringSegments; i++) {
      const theta = (i / ringSegments) * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(Math.cos(theta) * ringRadius, Math.sin(theta) * ringRadius, 0));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 1500,
      gapSize: 1000,
      transparent: true,
      opacity: 0.3,
    });
    this.acnCoverageLine = new THREE.LineLoop(ringGeo, ringMat);
    this.acnCoverageLine.computeLineDistances();
    this.acnGroup.add(this.acnCoverageLine);
  }

  /**
   * Initializes pre-allocated dynamic trajectory line loop.
   */
  private initTrajectory(): void {
    const positions = new Float32Array(this.trajectoryMaxPoints * 3);
    this.trajectoryGeo = new THREE.BufferGeometry();
    this.trajectoryGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const trajectoryMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 1200,
      gapSize: 800,
      transparent: true,
      opacity: 0.65,
    });

    this.trajectoryLine = new THREE.LineLoop(this.trajectoryGeo, trajectoryMat);
    this.trajectoryLine.name = 'acnTrajectoryLine';
    this.trajectoryGroup.add(this.trajectoryLine);
  }

  /**
   * Initializes all 16 ground terminals with 1x physical models, screen-space markers,
   * plumb reference lines, and terrain-occluded selection reticles.
   */
  private initGroundNodes(): void {
    const pMcp = ASSUMED_PHYSICAL_DIMENSIONS.mcpTerminal;
    const pSol = ASSUMED_PHYSICAL_DIMENSIONS.soldierTerminal;

    // 1. Shared MCP 1x Physical Geometries
    const mcpShelterGeo = new THREE.BoxGeometry(
      pMcp.shelterWidthM,
      pMcp.shelterLengthM,
      pMcp.shelterHeightM
    );
    const mcpDishGeo = new THREE.SphereGeometry(
      pMcp.dishDiameterM * 0.5,
      12,
      6,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.4
    );
    mcpDishGeo.rotateX(-Math.PI / 2);
    mcpDishGeo.translate(0, 0, pMcp.shelterHeightM * 0.8);

    // 2. Shared Soldier 1x Physical Geometry
    const soldierTripodGeo = new THREE.ConeGeometry(
      pSol.tripodBaseRadiusM,
      pSol.mastHeightM,
      6
    );
    soldierTripodGeo.rotateX(Math.PI / 2);
    soldierTripodGeo.translate(0, 0, pSol.mastHeightM * 0.5);

    // Plumb line material
    const plumbMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
    });

    for (let i = 0; i < 16; i++) {
      const isMcp = i === 0;
      const anchorLift = isMcp
        ? TACTICAL_MARKER_TARGET_PIXELS.mcpAnchorLiftM
        : TACTICAL_MARKER_TARGET_PIXELS.soldierAnchorLiftM;

      const nodeGroup = new THREE.Group();
      nodeGroup.name = `nodeGroup_${i}`;

      // A. Physical 1x 3D Model Group
      const visualGroup = new THREE.Group();
      visualGroup.name = `nodeVisual_${i}`;

      const nodeMat = new THREE.MeshStandardMaterial({
        color: isMcp ? 0x38bdf8 : 0x10b981,
        roughness: 0.3,
        metalness: 0.7,
        emissive: isMcp ? 0x0284c7 : 0x059669,
        emissiveIntensity: 0.4,
      });

      const markerMesh = isMcp
        ? new THREE.Mesh(mcpDishGeo, nodeMat)
        : new THREE.Mesh(soldierTripodGeo, nodeMat);
      markerMesh.name = `nodeMesh_${i}`;
      markerMesh.userData = { nodeId: i };
      visualGroup.add(markerMesh);

      if (isMcp) {
        const shelterMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
        const shelterMesh = new THREE.Mesh(mcpShelterGeo, shelterMat);
        shelterMesh.userData = { nodeId: i };
        visualGroup.add(shelterMesh);
      }
      visualGroup.userData = { nodeId: i };
      nodeGroup.add(visualGroup);

      // B. Plumb reference line (connects terrain ground point to elevated marker)
      const plumbPoints = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, anchorLift),
      ];
      const plumbGeo = new THREE.BufferGeometry().setFromPoints(plumbPoints);
      const markerPlumbLine = new THREE.Line(plumbGeo, plumbMat);
      markerPlumbLine.name = `nodePlumb_${i}`;
      nodeGroup.add(markerPlumbLine);

      // C. Marker Anchor Group (lifted above ground to prevent mountain slope clipping)
      const markerAnchorGroup = new THREE.Group();
      markerAnchorGroup.name = `markerAnchor_${i}`;
      markerAnchorGroup.position.set(0, 0, anchorLift);
      nodeGroup.add(markerAnchorGroup);

      // D. Screen-space tactical marker sprite
      const markerMat = new THREE.SpriteMaterial({
        map: isMcp ? this.mcpMarkerTexture : this.soldierMarkerTexture,
        sizeAttenuation: false,
        depthTest: true,        // Naturally occluded by mountain ridges!
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1.0,
        polygonOffsetUnits: -4.0,
        transparent: true,
        opacity: 1.0,
        color: isMcp ? 0xffffff : 0x10b981,
      });
      const markerSprite = new THREE.Sprite(markerMat);
      markerSprite.name = `markerSprite_${i}`;
      markerSprite.scale.set(0.025, 0.025, 1);
      markerSprite.userData = { nodeId: i };
      markerAnchorGroup.add(markerSprite);

      // E. Screen-space selection reticle (corner brackets, depth-tested)
      const reticleMat = new THREE.SpriteMaterial({
        map: this.reticleTexture,
        sizeAttenuation: false,
        depthTest: true,        // Must NOT falsely reveal occluded terminals!
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2.0,
        polygonOffsetUnits: -6.0,
        transparent: true,
        opacity: 0.95,
      });
      const selectionReticle = new THREE.Sprite(reticleMat);
      selectionReticle.name = `selectionReticle_${i}`;
      selectionReticle.userData = {}; // Explicitly empty: must never be picked
      selectionReticle.scale.set(0.04, 0.04, 1);
      selectionReticle.visible = i === this.selectedNodeId;
      markerAnchorGroup.add(selectionReticle);

      // F. Screen-space callsign badge
      const callsignLabel = isMcp ? 'MCP' : `S${i}`;
      const callsignMat = new THREE.SpriteMaterial({
        map: this.callsignTextures.get(callsignLabel),
        sizeAttenuation: false,
        depthTest: true,        // Naturally occluded by mountains!
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1.5,
        polygonOffsetUnits: -5.0,
        transparent: true,
        opacity: 1.0,
      });
      const callsignSprite = new THREE.Sprite(callsignMat);
      callsignSprite.name = `callsignSprite_${i}`;
      callsignSprite.userData = {}; // Explicitly empty: must never be picked
      callsignSprite.scale.set(0.07, 0.025, 1);
      callsignSprite.position.set(0, 0, isMcp ? 8.0 : 6.0);
      markerAnchorGroup.add(callsignSprite);

      // G. Unmapped Schematic Indicator (plumb line 1,700m to 5,000m)
      const unmappedIndicator = this.buildUnmappedIndicator(i);
      unmappedIndicator.visible = false;
      nodeGroup.add(unmappedIndicator);

      this.groundNodesGroup.add(nodeGroup);

      this.nodeItems.push({
        nodeId: i,
        isMcp,
        group: nodeGroup,
        visualGroup,
        markerMesh,
        markerAnchorGroup,
        markerSprite,
        markerPlumbLine,
        selectionReticle,
        unmappedIndicator,
        callsignSprite,
        hitTarget: markerSprite, // Marker sprite provides exact screen-space picking!
        lastZ: 0,
        isMapped: true,
        status: 'CONNECTED',
      });
    }
  }

  /**
   * Constructs explicit unmapped indicator when node coordinates fall outside DEM coverage.
   * Never fabricates ground elevation.
   */
  private buildUnmappedIndicator(nodeId: number): THREE.Group {
    const g = new THREE.Group();
    g.name = `unmappedSchematic_${nodeId}`;

    // Vertical dashed plumb ray spanning from 1,700m datum up to 5,000m ceiling
    const points = [
      new THREE.Vector3(0, 0, 1700.0),
      new THREE.Vector3(0, 0, 5000.0),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xa855f7, // Muted purple UNKNOWN indicator
      dashSize: 200,
      gapSize: 200,
      transparent: true,
      opacity: 0.75,
      depthTest: true,
    });
    const plumbLine = new THREE.Line(lineGeo, lineMat);
    plumbLine.computeLineDistances();
    g.add(plumbLine);

    // Schematic alert badge positioned at mid-height (3,350m)
    const alertTexture = createCallsignTexture(`[S${nodeId} UNMAPPED]`, '#a855f7');
    const alertMat = new THREE.SpriteMaterial({
      map: alertTexture,
      sizeAttenuation: false,
      depthTest: true,
      transparent: true,
      opacity: 0.9,
    });
    const alertSprite = new THREE.Sprite(alertMat);
    alertSprite.scale.set(0.12, 0.025, 1);
    alertSprite.position.set(0, 0, 3350.0);
    g.add(alertSprite);

    return g;
  }

  /**
   * Initializes 16 communication lines between ACN and ground nodes.
   */
  private initLinks(): void {
    const initialMat = this.materialPool.get('normal_CONNECTED')!;

    for (let i = 0; i < 16; i++) {
      const positions = new Float32Array(6); // 2 vertices x 3 components
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const line = new THREE.Line(geo, initialMat);
      line.name = `linkLine_${i}`;
      this.linksGroup.add(line);

      this.linkLines.push(line);
      this.linkGeometries.push(geo);
      this.linkMap.set(i, { line, geo });
    }
  }

  public getOrCreateLink(nodeId: number): { line: THREE.Line; geo: THREE.BufferGeometry } {
    let link = this.linkMap.get(nodeId);
    if (!link) {
      const initialMat = this.materialPool.get('normal_CONNECTED')!;
      const positions = new Float32Array(6);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const line = new THREE.Line(geo, initialMat);
      line.name = `linkLine_${nodeId}`;
      this.linksGroup.add(line);

      this.linkLines.push(line);
      this.linkGeometries.push(geo);
      link = { line, geo };
      this.linkMap.set(nodeId, link);
    }
    return link;
  }

  public getOrCreateNodeItem(nodeId: number, isMcp: boolean = false, callsign?: string): GroundNodeItem {
    let item = this.nodeItems.find(it => it.nodeId === nodeId);
    if (item) return item;

    const anchorLift = isMcp
      ? TACTICAL_MARKER_TARGET_PIXELS.mcpAnchorLiftM
      : TACTICAL_MARKER_TARGET_PIXELS.soldierAnchorLiftM;

    const nodeGroup = new THREE.Group();
    nodeGroup.name = `nodeGroup_${nodeId}`;

    const pMcp = ASSUMED_PHYSICAL_DIMENSIONS.mcpTerminal;
    const pSol = ASSUMED_PHYSICAL_DIMENSIONS.soldierTerminal;
    const mcpDishGeo = new THREE.CylinderGeometry(pMcp.dishDiameterM * 0.5, pMcp.dishDiameterM * 0.5, 0.4, 16);
    mcpDishGeo.rotateX(Math.PI / 4);
    mcpDishGeo.translate(0, 0, pMcp.mastHeightM);

    const mcpShelterGeo = new THREE.BoxGeometry(pMcp.shelterLengthM, pMcp.shelterWidthM, pMcp.shelterHeightM);
    mcpShelterGeo.translate(0, 0, pMcp.shelterHeightM * 0.5);

    const soldierTripodGeo = new THREE.ConeGeometry(pSol.tripodBaseRadiusM, pSol.mastHeightM, 6);
    soldierTripodGeo.rotateX(Math.PI / 2);
    soldierTripodGeo.translate(0, 0, pSol.mastHeightM * 0.5);

    const visualGroup = new THREE.Group();
    visualGroup.name = `nodeVisual_${nodeId}`;

    const nodeMat = new THREE.MeshStandardMaterial({
      color: isMcp ? 0x38bdf8 : 0x10b981,
      roughness: 0.3,
      metalness: 0.7,
      emissive: isMcp ? 0x0284c7 : 0x059669,
      emissiveIntensity: 0.4,
    });

    const markerMesh = isMcp
      ? new THREE.Mesh(mcpDishGeo, nodeMat)
      : new THREE.Mesh(soldierTripodGeo, nodeMat);
    markerMesh.name = `nodeMesh_${nodeId}`;
    markerMesh.userData = { nodeId };
    visualGroup.add(markerMesh);

    if (isMcp) {
      const shelterMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
      const shelterMesh = new THREE.Mesh(mcpShelterGeo, shelterMat);
      shelterMesh.userData = { nodeId };
      visualGroup.add(shelterMesh);
    }
    visualGroup.userData = { nodeId };
    nodeGroup.add(visualGroup);

    const plumbMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
    });
    const plumbPoints = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, anchorLift),
    ];
    const plumbGeo = new THREE.BufferGeometry().setFromPoints(plumbPoints);
    const markerPlumbLine = new THREE.Line(plumbGeo, plumbMat);
    markerPlumbLine.name = `nodePlumb_${nodeId}`;
    nodeGroup.add(markerPlumbLine);

    const markerAnchorGroup = new THREE.Group();
    markerAnchorGroup.name = `markerAnchor_${nodeId}`;
    markerAnchorGroup.position.set(0, 0, anchorLift);
    nodeGroup.add(markerAnchorGroup);

    const markerMat = new THREE.SpriteMaterial({
      map: isMcp ? this.mcpMarkerTexture : this.soldierMarkerTexture,
      sizeAttenuation: false,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0,
      transparent: true,
      opacity: 1.0,
      color: isMcp ? 0xffffff : 0x10b981,
    });
    const markerSprite = new THREE.Sprite(markerMat);
    markerSprite.name = `markerSprite_${nodeId}`;
    markerSprite.scale.set(0.025, 0.025, 1);
    markerSprite.userData = { nodeId };
    markerAnchorGroup.add(markerSprite);

    const reticleMat = new THREE.SpriteMaterial({
      map: this.reticleTexture,
      sizeAttenuation: false,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2.0,
      polygonOffsetUnits: -6.0,
      transparent: true,
      opacity: 0.95,
    });
    const selectionReticle = new THREE.Sprite(reticleMat);
    selectionReticle.name = `selectionReticle_${nodeId}`;
    selectionReticle.userData = {};
    selectionReticle.scale.set(0.04, 0.04, 1);
    selectionReticle.visible = nodeId === this.selectedNodeId;
    markerAnchorGroup.add(selectionReticle);

    const callsignLabel = callsign || (isMcp ? 'MCP' : `S${nodeId}`);
    let cTex = this.callsignTextures.get(callsignLabel);
    if (!cTex) {
      cTex = createCallsignTexture(callsignLabel, isMcp ? '#38bdf8' : '#10b981');
      this.callsignTextures.set(callsignLabel, cTex);
    }
    const callsignMat = new THREE.SpriteMaterial({
      map: cTex,
      sizeAttenuation: false,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -5.0,
      transparent: true,
      opacity: 1.0,
    });
    const callsignSprite = new THREE.Sprite(callsignMat);
    callsignSprite.name = `callsignSprite_${nodeId}`;
    callsignSprite.userData = {};
    callsignSprite.scale.set(0.07, 0.025, 1);
    callsignSprite.position.set(0, 0, isMcp ? 8.0 : 6.0);
    markerAnchorGroup.add(callsignSprite);

    const unmappedIndicator = this.buildUnmappedIndicator(nodeId);
    unmappedIndicator.visible = false;
    nodeGroup.add(unmappedIndicator);

    this.groundNodesGroup.add(nodeGroup);

    item = {
      nodeId,
      isMcp,
      group: nodeGroup,
      visualGroup,
      markerMesh,
      markerAnchorGroup,
      markerSprite,
      markerPlumbLine,
      selectionReticle,
      unmappedIndicator,
      callsignSprite,
      hitTarget: markerSprite,
      lastZ: 0,
      isMapped: true,
      status: 'CONNECTED',
    };
    this.nodeItems.push(item);
    return item;
  }

  /**
   * Initializes the verified bulk-transfer packet animation mesh.
   */
  private initBulkTransferPacket(): void {
    const packetGeo = new THREE.SphereGeometry(150.0, 12, 8);
    const packetMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
    });
    this.bulkPacketMesh = new THREE.Mesh(packetGeo, packetMat);
    this.bulkPacketMesh.name = 'bulkTransferPacket';
    this.bulkPacketMesh.visible = false;
    this.trafficGroup.add(this.bulkPacketMesh);
  }

  /**
   * Ingests 50 Hz TELEMETRY_FRAME from simulation worker and updates all entities.
   * Completely allocation-free: updates typed array buffers and matrix transforms in-place.
   */
  public updateFromTelemetry(frame: any): void {
    if (!frame) return;
    this.occlusionTelemetryVersion++;

    // 1. Update ACN Position & Orientation
    const acn = frame.acn_telemetry;
    if (acn) {
      const px = Number.isFinite(acn.pos_x) ? acn.pos_x : 0;
      const py = Number.isFinite(acn.pos_y) ? acn.pos_y : 0;
      const pz = Number.isFinite(acn.pos_z) ? acn.pos_z : 5000.0;
      this.acnAltitudeM = pz;

      this.acnGroup.position.set(px, py, pz);

      // Authoritative heading: rotZ = heading_rad - PI/2
      const vx = acn.vel_x ?? 0;
      const vy = acn.vel_y ?? 0;
      const speed = Math.hypot(vx, vy);

      if (Number.isFinite(acn.heading_rad) && speed >= 0.01) {
        this.lastValidHeadingRad = acn.heading_rad;
      }
      const rotZ = this.lastValidHeadingRad - Math.PI / 2;
      this.acnGroup.rotation.set(0, 0, rotZ, 'ZYX');

      // Update Trajectory Buffer in-place
      const fp = acn.flight_path;
      if (Array.isArray(fp) && fp.length >= 3) {
        const count = Math.min(fp.length, this.trajectoryMaxPoints);
        const posAttr = this.trajectoryGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          posAttr.setXYZ(i, fp[i][0], fp[i][1], this.acnAltitudeM);
        }
        posAttr.needsUpdate = true;
        this.trajectoryLine.geometry.setDrawRange(0, count);
        this.trajectoryLine.computeLineDistances();
      }
    }

    // 2. Update Ground Nodes & 3. Communication Links
    const nodes = frame.nodes_telemetry;
    const acnPos = this.acnGroup.position;

    if (Array.isArray(nodes)) {
      const activeIds = new Set(nodes.map(n => n.node_id));

      // Hide all items that are no longer active in telemetry
      for (const item of this.nodeItems) {
        if (!activeIds.has(item.nodeId)) {
          item.group.visible = false;
          item.visualGroup.visible = false;
          item.markerAnchorGroup.visible = false;
          item.markerSprite.visible = false;
          item.markerPlumbLine.visible = false;
          item.callsignSprite.visible = false;
          item.selectionReticle.visible = false;
          item.unmappedIndicator.visible = false;
          const link = this.linkMap.get(item.nodeId);
          if (link) link.line.visible = false;
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isMcp = node.node_type === 'mcp';
        const item = this.getOrCreateNodeItem(node.node_id, isMcp, node.name);
        item.group.visible = true;
        const isSel = node.node_id === this.selectedNodeId;

        // Check genuine DEM mapping
        const isMapped =
          node.is_coverage_complete !== false &&
          Number.isFinite(node.z_m) &&
          Number.isFinite(node.terrain_elevation_msl_m);

        item.isMapped = isMapped;
        item.selectionReticle.visible = isSel && isMapped;

        const { line: linkLine, geo: linkGeo } = this.getOrCreateLink(node.node_id);
        const linkPos = linkGeo.getAttribute('position') as THREE.BufferAttribute;
        linkPos.setXYZ(0, acnPos.x, acnPos.y, acnPos.z);

        if (isMapped) {
          // Mapped Node: place at authoritative terrain MSL + AGL
          item.group.position.set(node.x_m, node.y_m, node.z_m);
          item.visualGroup.visible = true;
          item.markerAnchorGroup.visible = true;
          item.markerPlumbLine.visible = true;
          item.unmappedIndicator.visible = false;
          item.lastZ = node.z_m;

          // Restore communication link and position at true ground coordinates
          linkLine.visible = true;
          linkPos.setXYZ(1, node.x_m, node.y_m, node.z_m);
        } else {
          // Unmapped Node: preserve known X/Y, NEVER fabricate ground Z
          item.group.position.set(node.x_m, node.y_m, 0);
          item.visualGroup.visible = false;
          item.markerAnchorGroup.visible = false;
          item.markerSprite.visible = false;
          item.markerPlumbLine.visible = false;
          item.callsignSprite.visible = false;
          item.selectionReticle.visible = false;
          item.unmappedIndicator.visible = true;

          // Communication link is completely hidden for unmapped nodes (no fabricated endpoint)
          linkLine.visible = false;
        }
        linkPos.needsUpdate = true;

        // Evaluate authoritative link classification
        const classification = classifyLinkCommunicationStatus(node);
        item.status = classification.status;
        const style = MAP_LINK_STYLES[classification.status] || MAP_LINK_STYLES.UNKNOWN;

        // Update node marker colors
        const nodeHex = this.parseCssColor(style.nodeColor);
        if (item.markerMesh.material instanceof THREE.MeshStandardMaterial) {
          item.markerMesh.material.color.setHex(nodeHex);
          item.markerMesh.material.emissive.setHex(nodeHex);
        }
        if (item.markerSprite.material instanceof THREE.SpriteMaterial && !item.isMcp) {
          item.markerSprite.material.color.setHex(nodeHex);
        }

        // Update link material from pre-allocated pool
        const matKey = `${isSel ? 'selected' : 'normal'}_${classification.status}`;
        const targetMat = this.materialPool.get(matKey) || this.materialPool.get('normal_UNKNOWN')!;
        if (linkLine.material !== targetMat) {
          linkLine.material = targetMat;
        }
        linkLine.computeLineDistances();
      }
    }

    // 4. Update Verified Bulk Transfer Packet Animation
    this.updateBulkTransferAnimation(frame);
  }

  /**
   * Projected-size-based LOD, camera-projected ACN heading, contact terrain occlusion,
   * and prioritized label decluttering.
   * Executed on every frame before rendering; zero dynamic heap allocations.
   */
  public updateLOD(
    camera: THREE.PerspectiveCamera,
    viewportWidth: number,
    viewportHeight: number,
    terrainMesh?: THREE.Mesh | null
  ): void {
    const vW = Math.max(10, viewportWidth);
    const vH = Math.max(10, viewportHeight);

    // 0. Contact Point Terrain Occlusion Evaluation with Invalidation Caching
    if (terrainMesh && terrainMesh.visible) {
      const camMoved =
        this.lastOcclusionCameraPosition.distanceToSquared(camera.position) > 1.0 ||
        this.lastOcclusionCameraQuaternion.angleTo(camera.quaternion) > 0.005;
      const terrainChanged = terrainMesh !== this.occlusionTerrainMeshRef;
      const telemetryChanged = this.occlusionTelemetryVersion !== this.lastEvaluatedTelemetryVersion;

      if (camMoved || terrainChanged || telemetryChanged) {
        this.lastOcclusionCameraPosition.copy(camera.position);
        this.lastOcclusionCameraQuaternion.copy(camera.quaternion);
        this.occlusionTerrainMeshRef = terrainMesh;
        this.lastEvaluatedTelemetryVersion = this.occlusionTelemetryVersion;

        for (let i = 0; i < 16; i++) {
          const item = this.nodeItems[i];
          if (!item.isMapped) {
            this.nodeContactOccluded[i] = false;
            continue;
          }

          // Ground contact point in root coordinates: (X_sim, Z_sim, -Y_sim)
          const contactRoot = this.scratchVecA.set(
            item.group.position.x,
            item.group.position.z,
            -item.group.position.y
          );
          const dir = this.scratchVecB.subVectors(contactRoot, camera.position);
          const dist = dir.length();
          if (dist > 5.0) {
            dir.divideScalar(dist);
            this.occlusionRaycaster.set(camera.position, dir);
            this.occlusionRaycaster.near = 1.0;
            this.occlusionRaycaster.far = dist;
            const hits = this.occlusionRaycaster.intersectObject(terrainMesh, false);
            // Occluded if an intervening ridge crest exists between camera and contact point
            this.nodeContactOccluded[i] = hits.some((h) => h.distance < dist - 5.0);
          } else {
            this.nodeContactOccluded[i] = false;
          }
        }
      }
    } else {
      this.nodeContactOccluded.fill(false);
    }

    // 1. Exact Screen-Space Sizing Factor
    const fovRad = (camera.fov * Math.PI) / 180.0;
    const tanHalfFov = Math.tan(fovRad * 0.5);
    const pxFactor = (2.0 * tanHalfFov) / vH;

    // Target scales
    const acnScale = TACTICAL_MARKER_TARGET_PIXELS.acn * pxFactor;
    const mcpScale = TACTICAL_MARKER_TARGET_PIXELS.mcp * pxFactor;
    const soldierScale = TACTICAL_MARKER_TARGET_PIXELS.soldier * pxFactor;
    const reticleScale = TACTICAL_MARKER_TARGET_PIXELS.reticle * pxFactor;
    const callsignScaleY = TACTICAL_MARKER_TARGET_PIXELS.callsignHeight * pxFactor;
    const callsignScaleX = TACTICAL_MARKER_TARGET_PIXELS.callsignWidth * pxFactor;

    // 2. ACN LOD & Heading Orientation
    const acnPosSim = this.acnGroup.position;
    // Inside worldGroup (rotation -PI/2 around X), simulation coords map to root coords:
    // X_root = X_sim, Y_root = Z_sim, Z_root = -Y_sim
    const acnPosRoot = this.scratchVecA.set(acnPosSim.x, acnPosSim.z, -acnPosSim.y);
    const distAcn = camera.position.distanceTo(acnPosRoot);

    // Projected physical wingspan size in pixels
    const pPhysAcn = (ASSUMED_PHYSICAL_DIMENSIONS.acn.wingspanM * vH) / (2.0 * distAcn * tanHalfFov);

    this.acnMarkerSprite.scale.set(acnScale, acnScale, 1.0);
    this.acnCallsignSprite.scale.set(callsignScaleX, callsignScaleY, 1.0);

    // Project authoritative forward flight vector into screen space
    const probeDist = Math.min(1000.0, Math.max(10.0, distAcn * 0.02));
    const vFwdRoot = this.scratchVecB.set(
      Math.cos(this.lastValidHeadingRad),
      0,
      -Math.sin(this.lastValidHeadingRad)
    );
    const pFwdRoot = this.scratchVecC.copy(acnPosRoot).addScaledVector(vFwdRoot, probeDist);

    const pCenterNDC = this.scratchVecB.copy(acnPosRoot).project(camera);
    const pFwdNDC = this.scratchVecC.copy(pFwdRoot).project(camera);

    const dx = (pFwdNDC.x - pCenterNDC.x) * (vW * 0.5);
    const dy = (pFwdNDC.y - pCenterNDC.y) * (vH * 0.5);
    const fwdScreenLen = Math.hypot(dx, dy);

    if (fwdScreenLen >= 0.2) {
      this.lastScreenHeadingRad = Math.atan2(dy, dx) - Math.PI / 2.0;
    }
    this.acnMarkerSprite.material.rotation = this.lastScreenHeadingRad;

    // ACN Continuous LOD Cross-Fade (Zero Opacity Pop)
    if (pPhysAcn <= 6.0) {
      this.acnMarkerSprite.visible = true;
      this.acnMarkerSprite.material.opacity = 1.0;
      this.acnVisualGroup.visible = false;
    } else if (pPhysAcn < 24.0) {
      const u = (pPhysAcn - 6.0) / 18.0;
      const t = u * u * (3.0 - 2.0 * u);
      this.acnMarkerSprite.visible = true;
      this.acnMarkerSprite.material.opacity = Math.max(0.0, Math.min(1.0, 1.0 - t));
      this.acnVisualGroup.visible = true;
    } else {
      this.acnMarkerSprite.visible = false;
      this.acnMarkerSprite.material.opacity = 0.0;
      this.acnVisualGroup.visible = true;
    }

    // 3. Ground Nodes LOD Evaluation & Contact Occlusion
    for (let i = 0; i < 16; i++) {
      const item = this.nodeItems[i];
      if (!item.isMapped) {
        item.visualGroup.visible = false;
        item.markerAnchorGroup.visible = false;
        item.markerSprite.visible = false;
        item.selectionReticle.visible = false;
        item.callsignSprite.visible = false;
        item.markerPlumbLine.visible = false;
        item.hitTarget = item.markerMesh;
        continue;
      }

      const isContactOccluded = this.nodeContactOccluded[i];

      const npSim = item.group.position;
      const npRoot = this.scratchVecA.set(npSim.x, npSim.z, -npSim.y);
      const dist = camera.position.distanceTo(npRoot);

      const physSizeM = item.isMcp
        ? ASSUMED_PHYSICAL_DIMENSIONS.mcpTerminal.mastHeightM
        : ASSUMED_PHYSICAL_DIMENSIONS.soldierTerminal.mastHeightM;

      const pPhys = (physSizeM * vH) / (2.0 * dist * tanHalfFov);

      // Apply screen-space scales
      const markerScale = item.isMcp ? mcpScale : soldierScale;
      item.markerSprite.scale.set(markerScale, markerScale, 1.0);
      item.selectionReticle.scale.set(reticleScale, reticleScale, 1.0);
      item.callsignSprite.scale.set(callsignScaleX, callsignScaleY, 1.0);

      // Node Continuous LOD Cross-Fade (Zero Opacity Pop)
      const minCutoff = item.isMcp ? 6.0 : 4.0;
      const fullCutoff = item.isMcp ? 24.0 : 16.0;

      if (isContactOccluded) {
        // Ridge between camera and ground contact hides elevated marker and reticle
        item.markerAnchorGroup.visible = false;
        item.markerSprite.visible = false;
        item.markerPlumbLine.visible = false;
        item.selectionReticle.visible = false;
        item.callsignSprite.visible = false;
        item.hitTarget = item.markerMesh;
      } else {
        item.markerAnchorGroup.visible = true;
        item.markerPlumbLine.visible = true;

        if (pPhys <= minCutoff) {
          item.markerSprite.visible = true;
          item.markerSprite.material.opacity = 1.0;
          item.visualGroup.visible = false;
          item.hitTarget = item.markerSprite;
        } else if (pPhys < fullCutoff) {
          const u = (pPhys - minCutoff) / (fullCutoff - minCutoff);
          const t = u * u * (3.0 - 2.0 * u);
          item.markerSprite.visible = true;
          item.markerSprite.material.opacity = Math.max(0.0, Math.min(1.0, 1.0 - t));
          item.visualGroup.visible = true;
          item.hitTarget = item.markerSprite;
        } else {
          item.markerSprite.visible = false;
          item.markerSprite.material.opacity = 0.0;
          item.visualGroup.visible = true;
          item.hitTarget = item.markerMesh;
        }

        item.selectionReticle.visible = item.nodeId === this.selectedNodeId && item.isMapped;
      }
    }

    // 4. Prioritized Label Decluttering with 2D Screen-Space Collision Culling
    this.declutterLabels(camera, vW, vH);
  }

  /**
   * Progressive disclosure and 2D collision suppression for callsign badges.
   * Zero heap allocations per frame by reusing pre-allocated scratch candidate buffers.
   */
  private declutterLabels(camera: THREE.PerspectiveCamera, vW: number, vH: number): void {
    this.declutterCandidateCount = 0;

    // Evaluate ACN callsign candidate
    const acnRoot = this.scratchVecA.set(
      this.acnGroup.position.x,
      this.acnGroup.position.z,
      -this.acnGroup.position.y
    );
    const acnNdc = this.scratchVecB.copy(acnRoot).project(camera);
    if (acnNdc.z <= 1.0) {
      const c = this.declutterCandidates[this.declutterCandidateCount++];
      c.sprite = this.acnCallsignSprite;
      c.priority = 2; // ACN is priority 2
      c.screenX = (acnNdc.x * 0.5 + 0.5) * vW;
      c.screenY = (-acnNdc.y * 0.5 + 0.5) * vH;
      c.dist = camera.position.distanceTo(acnRoot);
    } else {
      this.acnCallsignSprite.visible = false;
    }

    // Evaluate ground node candidates
    for (let i = 0; i < 16; i++) {
      const item = this.nodeItems[i];
      if (!item.isMapped || this.nodeContactOccluded[i]) {
        item.callsignSprite.visible = false;
        continue;
      }

      const nodeRoot = this.scratchVecA.set(
        item.group.position.x,
        item.group.position.z,
        -item.group.position.y
      );
      const dist = camera.position.distanceTo(nodeRoot);
      const ndc = this.scratchVecB.copy(nodeRoot).project(camera);

      // Discard objects behind camera frustum
      if (ndc.z > 1.0) {
        item.callsignSprite.visible = false;
        continue;
      }

      const isSelected = item.nodeId === this.selectedNodeId;
      const isOutageOrDegraded =
        item.status === 'OUTAGE_DISCONNECTED' ||
        item.status === 'DEGRADED' ||
        item.status === 'BLOCKED_TERRAIN' ||
        item.status === 'BLOCKED_OBSTACLE';

      // Progressive zoom distance filter
      if (dist > 80000.0) {
        // Overview distance: only Selected and MCP
        if (!isSelected && !item.isMcp) {
          item.callsignSprite.visible = false;
          continue;
        }
      } else if (dist > 35000.0) {
        // Sector distance: Selected, MCP, and degraded/outage nodes
        if (!isSelected && !item.isMcp && !isOutageOrDegraded) {
          item.callsignSprite.visible = false;
          continue;
        }
      }

      // Priority ranking: 1 (Selected) > 3 (MCP) > 4 (Outage) > 5 (Nominal)
      let priority = 5;
      if (isSelected) priority = 1;
      else if (item.isMcp) priority = 3;
      else if (isOutageOrDegraded) priority = 4;

      const c = this.declutterCandidates[this.declutterCandidateCount++];
      c.sprite = item.callsignSprite;
      c.priority = priority;
      c.screenX = (ndc.x * 0.5 + 0.5) * vW;
      c.screenY = (-ndc.y * 0.5 + 0.5) * vH;
      c.dist = dist;
    }

    // Sort candidates in-place: priority ascending (highest priority first), then distance
    for (let i = 1; i < this.declutterCandidateCount; i++) {
      let j = i;
      while (j > 0) {
        const a = this.declutterCandidates[j - 1];
        const b = this.declutterCandidates[j];
        const cmp = a.priority !== b.priority ? a.priority - b.priority : a.dist - b.dist;
        if (cmp > 0) {
          this.declutterCandidates[j - 1] = b;
          this.declutterCandidates[j] = a;
          j--;
        } else {
          break;
        }
      }
    }

    // 2D Screen-space collision culling (bounding box: 56px x 20px)
    const halfW = 28.0;
    const halfH = 10.0;
    this.declutterAcceptedCount = 0;

    for (let i = 0; i < this.declutterCandidateCount; i++) {
      const c = this.declutterCandidates[i];
      if (!c.sprite) continue;

      const minX = c.screenX - halfW;
      const maxX = c.screenX + halfW;
      const minY = c.screenY - halfH;
      const maxY = c.screenY + halfH;

      let collides = false;
      for (let j = 0; j < this.declutterAcceptedCount; j++) {
        const accepted = this.declutterAcceptedBoxes[j];
        if (
          !(
            maxX < accepted.minX ||
            minX > accepted.maxX ||
            maxY < accepted.minY ||
            minY > accepted.maxY
          )
        ) {
          collides = true;
          break;
        }
      }

      if (!collides) {
        const acceptedBox = this.declutterAcceptedBoxes[this.declutterAcceptedCount++];
        acceptedBox.minX = minX;
        acceptedBox.maxX = maxX;
        acceptedBox.minY = minY;
        acceptedBox.maxY = maxY;
        c.sprite.visible = true;
      } else {
        c.sprite.visible = false;
      }
    }
  }

  /**
   * Animates packet particles strictly when transfer telemetry confirms active transmission
   * and delivered bytes increase. Leaves general TDMA traffic animation disabled.
   */
  private updateBulkTransferAnimation(frame: any): void {
    const tt = frame.transfer_telemetry;
    const isTransmitting = tt && tt.status === 'TRANSMITTING';
    const delivered = tt && typeof tt.delivered_bytes === 'number' ? tt.delivered_bytes : 0;
    const hasProgress = isTransmitting && delivered > this.lastDeliveredBytes;

    if (isTransmitting && hasProgress) {
      const targetNodeId = typeof tt.node_id === 'number' ? tt.node_id : 4;
      const targetNode = this.nodeItems.find((n) => n.nodeId === targetNodeId);

      if (targetNode && targetNode.isMapped) {
        this.bulkPacketMesh.visible = true;
        this.bulkTransferProgress = (this.bulkTransferProgress + 0.08) % 1.0;

        const np = targetNode.group.position;
        const ap = this.acnGroup.position;
        const t = this.bulkTransferProgress;

        this.bulkPacketMesh.position.set(
          np.x + (ap.x - np.x) * t,
          np.y + (ap.y - np.y) * t,
          np.z + (ap.z - np.z) * t
        );
      } else {
        this.bulkPacketMesh.visible = false;
      }
    } else {
      this.bulkPacketMesh.visible = false;
      this.bulkTransferProgress = 0;
    }

    if (tt && typeof tt.delivered_bytes === 'number') {
      this.lastDeliveredBytes = tt.delivered_bytes;
    }
  }

  /**
   * Sets active selected node ID and refreshes selection reticles and link thicknesses.
   */
  public setSelectedNode(nodeId: number): void {
    if (this.selectedNodeId === nodeId) return;
    this.selectedNodeId = nodeId;

    for (const item of this.nodeItems) {
      item.selectionReticle.visible = item.nodeId === nodeId && item.isMapped;
    }
  }

  public getSelectedNodeId(): number {
    return this.selectedNodeId;
  }

  public isNodeContactOccluded(nodeId: number): boolean {
    if (nodeId < 0 || nodeId >= 16) return false;
    return this.nodeContactOccluded[nodeId];
  }

  public invalidateOcclusionCache(): void {
    this.lastEvaluatedTelemetryVersion = -1;
    this.lastOcclusionCameraPosition.set(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
  }

  /**
   * Returns array of hit targets for camera raycaster picking.
   * Filters out unmapped nodes, terrain-occluded contacts, and hidden LOD layers.
   */
  public getSelectableObjects(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];

    // 1. ACN
    if (this.acnGroup.visible && isObjectVisibleInHierarchy(this.acnGroup)) {
      if (this.acnMarkerSprite.visible && isObjectVisibleInHierarchy(this.acnMarkerSprite)) {
        targets.push(this.acnMarkerSprite);
      }
      if (this.acnVisualGroup.visible && isObjectVisibleInHierarchy(this.acnVisualGroup)) {
        for (const child of this.acnVisualGroup.children) {
          if (child instanceof THREE.Mesh && child.visible) {
            targets.push(child);
          }
        }
      }
    }

    // 2. Ground Nodes
    for (let i = 0; i < 16; i++) {
      const item = this.nodeItems[i];
      if (!item.isMapped || !item.group.visible || !isObjectVisibleInHierarchy(item.group)) {
        continue;
      }
      if (this.nodeContactOccluded[i]) {
        continue;
      }

      // If overview marker sprite is visible
      if (item.markerSprite.visible && isObjectVisibleInHierarchy(item.markerSprite)) {
        targets.push(item.markerSprite);
      }

      // If physical model is visible at close LOD
      if (item.visualGroup.visible && isObjectVisibleInHierarchy(item.visualGroup)) {
        for (const child of item.visualGroup.children) {
          if (child instanceof THREE.Mesh && child.visible) {
            targets.push(child);
          }
        }
      }
    }

    return targets;
  }

  /**
   * Returns array of hit targets for camera raycaster picking (legacy diagnostic getter).
   */
  public getHitTargets(): THREE.Object3D[] {
    return this.nodeItems.map((item) => item.hitTarget);
  }

  public onNodeSelected(callback: (nodeId: number) => void): void {
    this.onNodeSelectedCallbacks.push(callback);
  }

  public triggerNodeSelected(nodeId: number): void {
    this.setSelectedNode(nodeId);
    for (const cb of this.onNodeSelectedCallbacks) {
      cb(nodeId);
    }
  }

  /**
   * Diagnostic getters for automated verification
   */
  public getAcnMeshPosition(): THREE.Vector3 {
    return this.acnGroup.position;
  }

  public getAcnHeadingRad(): number {
    return this.lastValidHeadingRad;
  }

  public getAcnScreenHeadingRad(): number {
    return this.lastScreenHeadingRad;
  }

  public getAcnYawRotation(): number {
    return this.acnGroup.rotation.z;
  }

  public getAcnMarkerSprite(): THREE.Sprite {
    return this.acnMarkerSprite;
  }

  public getAcnVisualGroup(): THREE.Group {
    return this.acnVisualGroup;
  }

  public getAcnFuselageMesh(): THREE.Mesh | undefined {
    return this.acnVisualGroup.children.find(
      (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.ConeGeometry
    ) as THREE.Mesh | undefined;
  }

  public getNodeItem(nodeId: number): GroundNodeItem | undefined {
    return this.nodeItems.find((n) => n.nodeId === nodeId);
  }

  public getLinkLine(index: number): THREE.Line | undefined {
    return this.linkLines[index];
  }

  public getTrajectoryVertexCount(): number {
    return (this.trajectoryGeo.getAttribute('position') as THREE.BufferAttribute).count;
  }

  public getBulkTransferMesh(): THREE.Mesh {
    return this.bulkPacketMesh;
  }

  /**
   * Clean resource disposal on teardown
   */
  public dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    // Collect all geometries, materials, and textures from rootGroup hierarchy
    this.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
        if ('geometry' in obj && obj.geometry instanceof THREE.BufferGeometry) {
          geometries.add(obj.geometry);
        }
        if ('material' in obj) {
          const mat = obj.material;
          if (Array.isArray(mat)) {
            for (const m of mat) {
              if (m instanceof THREE.Material) materials.add(m);
            }
          } else if (mat instanceof THREE.Material) {
            materials.add(mat);
          }
        }
      }
    });

    // Material pool
    for (const mat of this.materialPool.values()) {
      materials.add(mat);
    }
    this.materialPool.clear();

    // Link and trajectory geometries
    for (const geo of this.linkGeometries) {
      geometries.add(geo);
    }
    geometries.add(this.trajectoryGeo);

    // Canvas textures
    if (this.acnMarkerTexture) textures.add(this.acnMarkerTexture);
    if (this.mcpMarkerTexture) textures.add(this.mcpMarkerTexture);
    if (this.soldierMarkerTexture) textures.add(this.soldierMarkerTexture);
    if (this.reticleTexture) textures.add(this.reticleTexture);
    for (const tex of this.callsignTextures.values()) {
      textures.add(tex);
    }
    this.callsignTextures.clear();

    // Materials' map textures
    for (const mat of materials) {
      if ('map' in mat && (mat as any).map instanceof THREE.Texture) {
        textures.add((mat as any).map);
      }
    }

    // Dispose all collected GPU resources
    for (const geo of geometries) {
      geo.dispose();
    }
    for (const mat of materials) {
      mat.dispose();
    }
    for (const tex of textures) {
      tex.dispose();
    }

    // Clear callbacks and references
    this.onNodeSelectedCallbacks = [];
    this.nodeItems.length = 0;
    this.linkLines.length = 0;
    this.linkGeometries.length = 0;
    this.linkMap.clear();
  }
}
