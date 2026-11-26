/**
 * src/ui/workspaceTilesManager.ts
 *
 * Workspace Tiles Layout Mode for the 2D Radar Map.
 *
 * Allows operators to display multiple Terrain Toolbox panels side-by-side
 * directly on the radar map for concurrent monitoring of different tool telemetry
 * (Terrain/DEM, Measure Line & LoS, RF Site Probe, Area Coverage Scan, and
 * 3D Barrier Link-Slicer) while keeping full interactive map access.
 */

import {
  computeRfSinrMeterState,
  computeQgisCoverageBreakdown,
  computeAoSwathEdgeDimensions,
  DEM_QUICK_PRESETS,
  resolveDemQuickPresetFromSector,
} from './toolboxPrecisionSuite';
import { escapeHtml } from './domSafety';

// ============================================================================
// Types & Constants
// ============================================================================

export type WorkspaceTileId = 'dem' | 'transect' | 'probe' | 'region' | 'obstacle';
export type WorkspaceTilesLayoutMode = 'row' | 'grid';
export type WorkspaceTilesPresetId = 'rf_pair' | 'tactical_trio' | 'full_quad';
export type WorkspaceTileTone = 'clear' | 'marginal' | 'blocked' | 'neutral';

export interface WorkspaceTileMeta {
  readonly id: WorkspaceTileId;
  readonly title: string;
  readonly shortLabel: string;
  readonly accentVar: string;
  readonly hotkey: string;
}

export interface WorkspaceTilesState {
  readonly enabled: boolean;
  readonly layout: WorkspaceTilesLayoutMode;
  readonly openTiles: readonly WorkspaceTileId[];
  readonly collapsedTiles: readonly WorkspaceTileId[];
  readonly focusedTile: WorkspaceTileId;
}

export interface WorkspaceTilePreset {
  readonly id: WorkspaceTilesPresetId;
  readonly label: string;
  readonly tiles: readonly WorkspaceTileId[];
  readonly layout: WorkspaceTilesLayoutMode;
}

export interface WorkspaceTileMetric {
  readonly label: string;
  readonly value: string;
}

export interface WorkspaceTileTelemetry {
  readonly tileId: WorkspaceTileId;
  readonly heroLabel: string;
  readonly heroValue: string;
  readonly statusLabel: string;
  readonly tone: WorkspaceTileTone;
  readonly metrics: readonly WorkspaceTileMetric[];
  readonly meterPct?: number;
  readonly coverageBar?: {
    readonly clearPct: number;
    readonly marginalPct: number;
    readonly deadZonePct: number;
  };
  readonly footerHint: string;
}

export interface WorkspaceTilesTelemetryInput {
  readonly activeMode?: string;
  readonly toolMode?: string;
  readonly stageViewMode?: string;
  readonly radarRangeM?: number;
  readonly backdropMode?: string;
  readonly terrainSource?: string;
  readonly terrainSector?: string;
  readonly terrainElevMinM?: number | null;
  readonly terrainElevMaxM?: number | null;
  readonly terrainGridSize?: string;
  readonly transectWaypoints?: readonly any[];
  readonly transectResult?: any;
  readonly rulerMetrics?: any;
  readonly rulerEvaluation?: any;
  readonly transectSnrLabel?: string;
  readonly transectFresnelLabel?: string;
  readonly probeSite?: any;
  readonly cursorProbeLive?: any;
  readonly viewshedResult?: any;
  readonly aoSwathBox?: any;
  readonly aoSwathReport?: any;
  readonly obstacles?: readonly any[];
  readonly obsSelectedId?: string | number | null;
  readonly cadObstacleReport?: any;
  readonly groundNodeCount?: number;
  readonly firstGroundNodeId?: number | null;
}

export const WORKSPACE_TILE_ORDER: readonly WorkspaceTileId[] = [
  'dem',
  'transect',
  'probe',
  'region',
  'obstacle',
];

export const MAX_OPEN_WORKSPACE_TILES = 4;
export const MIN_OPEN_WORKSPACE_TILES = 1;
export const WORKSPACE_TILES_STORAGE_KEY = 'stratos.workspaceTiles.v1';

export const WORKSPACE_TILE_META: Record<WorkspaceTileId, WorkspaceTileMeta> = {
  dem: {
    id: 'dem',
    title: 'Terrain',
    shortLabel: 'Terrain',
    accentVar: 'dem',
    hotkey: 'V',
  },
  transect: {
    id: 'transect',
    title: 'Line & LoS',
    shortLabel: 'Line',
    accentVar: 'transect',
    hotkey: 'R',
  },
  probe: {
    id: 'probe',
    title: 'RF Probe',
    shortLabel: 'Probe',
    accentVar: 'probe',
    hotkey: 'P',
  },
  region: {
    id: 'region',
    title: 'Area Scan',
    shortLabel: 'Area',
    accentVar: 'region',
    hotkey: 'A',
  },
  obstacle: {
    id: 'obstacle',
    title: '3D Barrier',
    shortLabel: 'Barrier',
    accentVar: 'obstacle',
    hotkey: 'B',
  },
};

export const WORKSPACE_TILE_PRESETS: readonly WorkspaceTilePreset[] = [
  {
    id: 'rf_pair',
    label: '2-Up',
    tiles: ['transect', 'probe'],
    layout: 'row',
  },
  {
    id: 'tactical_trio',
    label: '3-Up',
    tiles: ['transect', 'probe', 'region'],
    layout: 'row',
  },
  {
    id: 'full_quad',
    label: '2×2',
    tiles: ['transect', 'probe', 'region', 'obstacle'],
    layout: 'grid',
  },
];

// ============================================================================
// Pure State & Layout Reducers (Unit-Tested)
// ============================================================================

export function isWorkspaceTileId(value: unknown): value is WorkspaceTileId {
  return (
    value === 'dem' ||
    value === 'transect' ||
    value === 'probe' ||
    value === 'region' ||
    value === 'obstacle'
  );
}

export function createDefaultWorkspaceTilesState(): WorkspaceTilesState {
  return {
    enabled: false,
    layout: 'row',
    openTiles: ['transect', 'probe', 'region'],
    collapsedTiles: [],
    focusedTile: 'transect',
  };
}

export function toggleWorkspaceTilesEnabled(
  state: WorkspaceTilesState,
  force?: boolean
): WorkspaceTilesState {
  const nextEnabled = typeof force === 'boolean' ? force : !state.enabled;
  const openTiles =
    state.openTiles.length > 0 ? state.openTiles : createDefaultWorkspaceTilesState().openTiles;
  return {
    ...state,
    enabled: nextEnabled,
    openTiles,
    focusedTile: openTiles.includes(state.focusedTile) ? state.focusedTile : openTiles[0],
  };
}

export function toggleWorkspaceTile(
  state: WorkspaceTilesState,
  tileId: WorkspaceTileId
): WorkspaceTilesState {
  const exists = state.openTiles.includes(tileId);
  if (exists) {
    if (state.openTiles.length <= MIN_OPEN_WORKSPACE_TILES) {
      return { ...state, focusedTile: tileId };
    }
    const nextOpen = state.openTiles.filter((id) => id !== tileId);
    const nextCollapsed = state.collapsedTiles.filter((id) => id !== tileId);
    return {
      ...state,
      openTiles: nextOpen,
      collapsedTiles: nextCollapsed,
      focusedTile: state.focusedTile === tileId ? nextOpen[0] : state.focusedTile,
    };
  }

  let nextOpen: WorkspaceTileId[];
  if (state.openTiles.length >= MAX_OPEN_WORKSPACE_TILES) {
    // Replace oldest non-focused tile to keep count <= 4 cleanly
    const evictIdx = state.openTiles.findIndex((id) => id !== state.focusedTile);
    const removeAt = evictIdx >= 0 ? evictIdx : 0;
    nextOpen = [
      ...state.openTiles.slice(0, removeAt),
      ...state.openTiles.slice(removeAt + 1),
      tileId,
    ];
  } else {
    nextOpen = [...state.openTiles, tileId];
  }

  return {
    ...state,
    enabled: true,
    openTiles: nextOpen,
    collapsedTiles: state.collapsedTiles.filter((id) => nextOpen.includes(id)),
    focusedTile: tileId,
  };
}

export function closeWorkspaceTile(
  state: WorkspaceTilesState,
  tileId: WorkspaceTileId
): WorkspaceTilesState {
  if (!state.openTiles.includes(tileId)) return state;
  const nextOpen = state.openTiles.filter((id) => id !== tileId);
  if (nextOpen.length === 0) {
    return {
      ...state,
      enabled: false,
      openTiles: createDefaultWorkspaceTilesState().openTiles,
      collapsedTiles: [],
    };
  }
  return {
    ...state,
    openTiles: nextOpen,
    collapsedTiles: state.collapsedTiles.filter((id) => id !== tileId),
    focusedTile: state.focusedTile === tileId ? nextOpen[0] : state.focusedTile,
  };
}

export function moveWorkspaceTile(
  state: WorkspaceTilesState,
  tileId: WorkspaceTileId,
  direction: -1 | 1
): WorkspaceTilesState {
  const idx = state.openTiles.indexOf(tileId);
  if (idx < 0) return state;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= state.openTiles.length) return state;
  const nextOpen = [...state.openTiles];
  const tmp = nextOpen[idx];
  nextOpen[idx] = nextOpen[targetIdx];
  nextOpen[targetIdx] = tmp;
  return {
    ...state,
    openTiles: nextOpen,
  };
}

export function toggleWorkspaceTileCollapsed(
  state: WorkspaceTilesState,
  tileId: WorkspaceTileId
): WorkspaceTilesState {
  if (!state.openTiles.includes(tileId)) return state;
  const isCollapsed = state.collapsedTiles.includes(tileId);
  return {
    ...state,
    collapsedTiles: isCollapsed
      ? state.collapsedTiles.filter((id) => id !== tileId)
      : [...state.collapsedTiles, tileId],
  };
}

export function setWorkspaceTilesLayout(
  state: WorkspaceTilesState,
  layout: WorkspaceTilesLayoutMode
): WorkspaceTilesState {
  return {
    ...state,
    layout,
  };
}

export function setWorkspaceFocusedTile(
  state: WorkspaceTilesState,
  tileId: WorkspaceTileId
): WorkspaceTilesState {
  return {
    ...state,
    focusedTile: tileId,
  };
}

export function applyWorkspaceTilesPreset(
  state: WorkspaceTilesState,
  presetId: WorkspaceTilesPresetId
): WorkspaceTilesState {
  const preset = WORKSPACE_TILE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return state;
  return {
    ...state,
    enabled: true,
    layout: preset.layout,
    openTiles: [...preset.tiles],
    collapsedTiles: state.collapsedTiles.filter((id) => preset.tiles.includes(id)),
    focusedTile: preset.tiles.includes(state.focusedTile) ? state.focusedTile : preset.tiles[0],
  };
}

export function computeWorkspaceGridColumns(
  tileCount: number,
  layout: WorkspaceTilesLayoutMode,
  containerWidthPx: number
): number {
  const count = Math.max(1, Math.min(MAX_OPEN_WORKSPACE_TILES, Math.floor(tileCount)));
  const width = Number.isFinite(containerWidthPx) && containerWidthPx > 0 ? containerWidthPx : 820;
  if (layout === 'grid') {
    if (count <= 1 || width < 440) return 1;
    return 2;
  }
  const minTileWidth = 205;
  const maxColsForWidth = Math.max(1, Math.floor(width / minTileWidth));
  return Math.max(1, Math.min(count, maxColsForWidth));
}

export function serializeWorkspaceTilesState(state: WorkspaceTilesState): string {
  return JSON.stringify({
    enabled: state.enabled,
    layout: state.layout,
    openTiles: state.openTiles,
    collapsedTiles: state.collapsedTiles,
    focusedTile: state.focusedTile,
  });
}

export function deserializeWorkspaceTilesState(raw: string | null | undefined): WorkspaceTilesState {
  const fallback = createDefaultWorkspaceTilesState();
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const rawOpen = Array.isArray(parsed.openTiles) ? parsed.openTiles.filter(isWorkspaceTileId) : [];
    const dedupOpen = Array.from(new Set<WorkspaceTileId>(rawOpen)).slice(0, MAX_OPEN_WORKSPACE_TILES);
    const openTiles = dedupOpen.length >= MIN_OPEN_WORKSPACE_TILES ? dedupOpen : fallback.openTiles;
    const rawCollapsed = Array.isArray(parsed.collapsedTiles)
      ? parsed.collapsedTiles.filter((id: unknown): id is WorkspaceTileId => isWorkspaceTileId(id) && openTiles.includes(id))
      : [];
    const layout: WorkspaceTilesLayoutMode = parsed.layout === 'grid' ? 'grid' : 'row';
    const focusedTile: WorkspaceTileId =
      isWorkspaceTileId(parsed.focusedTile) && openTiles.includes(parsed.focusedTile)
        ? parsed.focusedTile
        : openTiles[0];
    return {
      enabled: Boolean(parsed.enabled),
      layout,
      openTiles,
      collapsedTiles: Array.from(new Set(rawCollapsed)),
      focusedTile,
    };
  } catch {
    return fallback;
  }
}

// ============================================================================
// Pure Live Telemetry Formatters for Each Tool Tile
// ============================================================================

function formatSignedMeters(val: number | null | undefined): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return '--';
  const r = Math.round(val);
  return `${r >= 0 ? '+' : ''}${r} m`;
}

function compassFromDeg(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const norm = ((deg % 360) + 360) % 360;
  return dirs[Math.round(norm / 45) % 8];
}

export function buildWorkspaceTileTelemetry(
  tileId: WorkspaceTileId,
  input: WorkspaceTilesTelemetryInput
): WorkspaceTileTelemetry {
  if (tileId === 'dem') {
    const presetId = resolveDemQuickPresetFromSector(String(input.terrainSector || ''));
    const presetObj = DEM_QUICK_PRESETS.find((p) => p.id === presetId);
    const presetLabel = presetObj?.label ?? (input.terrainSource || 'Active DEM');
    const spanKm =
      typeof input.radarRangeM === 'number' && Number.isFinite(input.radarRangeM)
        ? `${((input.radarRangeM * 2) / 1000).toFixed(0)} km`
        : '--';
    const elevRange =
      typeof input.terrainElevMinM === 'number' &&
      Number.isFinite(input.terrainElevMinM) &&
      typeof input.terrainElevMaxM === 'number' &&
      Number.isFinite(input.terrainElevMaxM)
        ? `${Math.round(input.terrainElevMinM)}–${Math.round(input.terrainElevMaxM)} m`
        : '--';
    const shading =
      input.backdropMode === 'slope'
        ? 'Slope °'
        : input.backdropMode === 'ridge'
          ? 'Ridge Crest'
          : 'Relief';
    return {
      tileId: 'dem',
      heroLabel: 'Active Sector',
      heroValue: presetLabel,
      statusLabel: shading,
      tone: 'neutral',
      metrics: [
        { label: 'Elev MSL', value: elevRange },
        { label: 'Map Span', value: spanKm },
        { label: 'DEM Grid', value: input.terrainGridSize || '512×512' },
        { label: 'Nodes', value: String(input.groundNodeCount ?? 0) },
      ],
      footerHint: 'Switch terrain presets or fit DEM.',
    };
  }

  if (tileId === 'transect') {
    const res = input.transectResult;
    const rm = input.rulerMetrics;
    const rev = input.rulerEvaluation;
    const distM = Number(res?.totalHorizontalM ?? rm?.horizontalDistanceM ?? NaN);
    const hasLine = Number.isFinite(distM) && distM > 1;
    if (!hasLine) {
      return {
        tileId: 'transect',
        heroLabel: 'Distance A → B',
        heroValue: '--',
        statusLabel: 'Ready',
        tone: 'neutral',
        metrics: [
          { label: 'Bearing', value: '--' },
          { label: 'Elev Δ', value: '--' },
          { label: 'Min F1', value: '--' },
          { label: '8 GHz SNR', value: '--' },
        ],
        footerHint: 'Click Measure A → B, then pick 2 points.',
      };
    }

    const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(2)} km` : `${Math.round(distM)} m`;
    const azDeg = Number(rm?.azimuthDeg ?? res?.azimuthDeg ?? rm?.bearingDeg ?? NaN);
    const octant = rm?.cardinalOctant || (Number.isFinite(azDeg) ? compassFromDeg(azDeg) : '');
    const bearingStr = Number.isFinite(azDeg) ? `${Math.round(azDeg)}° ${octant}`.trim() : '--';
    const elevDelta = Number(
      rm?.groundElevationDeltaM ?? rm?.deltaZM ?? rm?.antennaElevationDeltaM ?? rm?.elevationDeltaM ?? res?.elevDeltaM ?? rm?.elevDeltaM ?? NaN
    );
    const minF1 = Number(
      res?.minFresnelClearanceM ?? rev?.minFresnelClearanceM ?? rev?.minClearanceM ?? NaN
    );
    const snrDb = Number(res?.estSnrDb ?? rev?.estSnrDb ?? NaN);
    const blocked =
      rev && typeof rev.isLineOfSightClear === 'boolean'
        ? !rev.isLineOfSightClear
        : Boolean(res?.isObstructed ?? (rev && rev.isLos === false));
    const snrStr = Number.isFinite(snrDb)
      ? `${snrDb.toFixed(1)} dB`
      : (input.transectSnrLabel && input.transectSnrLabel !== '-- dB / --'
          ? input.transectSnrLabel.split('/')[0].trim()
          : (blocked ? 'OUTAGE' : 'CLEAR'));
    const f1Str = Number.isFinite(minF1)
      ? `${Math.round(minF1)} m`
      : (input.transectFresnelLabel && input.transectFresnelLabel !== '-- m (100%)'
          ? input.transectFresnelLabel.split('(')[0].trim()
          : '--');

    return {
      tileId: 'transect',
      heroLabel: 'Distance A → B',
      heroValue: distStr,
      statusLabel: blocked ? 'BLOCKED' : 'CLEAR LOS',
      tone: blocked ? 'blocked' : 'clear',
      metrics: [
        { label: 'Bearing', value: bearingStr },
        { label: 'Elev Δ', value: formatSignedMeters(elevDelta) },
        { label: 'Min Clr', value: f1Str },
        { label: '8 GHz SNR', value: snrStr },
      ],
      footerHint: 'Drag A or B handles on map to live-update.',
    };
  }

  if (tileId === 'probe') {
    const site = input.probeSite;
    const live = input.cursorProbeLive;
    const vs = input.viewshedResult;
    const sinrVal = Number(live?.estSinrDb ?? vs?.acnLink?.estSinrDb ?? vs?.estSinrDb ?? NaN);
    const hasProbe = (Boolean(site) || Boolean(live)) && Number.isFinite(sinrVal);
    const isLos = Boolean(live?.isLos ?? vs?.acnLink?.isLos ?? vs?.isLos ?? false);

    if (!hasProbe) {
      return {
        tileId: 'probe',
        heroLabel: '8 GHz SINR',
        heroValue: '-- dB',
        statusLabel: 'Standby',
        tone: 'neutral',
        meterPct: 0,
        metrics: [
          { label: 'MODCOD', value: '--' },
          { label: 'Slant', value: '--' },
          { label: 'Elev Ang', value: '--' },
          { label: 'Sky Open', value: '--' },
        ],
        footerHint: 'Click Pick Site, then click the radar map.',
      };
    }

    const meter = computeRfSinrMeterState(sinrVal, isLos);
    const tone: WorkspaceTileTone =
      meter.tone === 'clear'
        ? 'clear'
        : meter.tone === 'marginal'
          ? 'marginal'
          : meter.tone === 'shadowed'
            ? 'blocked'
            : 'neutral';
    const statusWord =
      tone === 'clear' ? 'Strong' : tone === 'marginal' ? 'Weak' : 'Blocked';
    const slantKm = Number(
      live?.d3dKm ??
        (Number.isFinite(vs?.acnLink?.slantRangeM)
          ? vs.acnLink.slantRangeM / 1000
          : Number.isFinite(vs?.slantRangeM)
            ? vs.slantRangeM / 1000
            : NaN)
    );
    const elevAng = Number(
      live?.elToAcnDeg ?? vs?.acnLink?.elevationAngleDeg ?? vs?.elevationAngleDeg ?? NaN
    );
    const skyPct = Number(
      live?.skyOpennessPct ?? vs?.skyOpenPct ?? vs?.openSkyPct ?? NaN
    );
    const modcod = String(
      live?.modcodName ?? vs?.acnLink?.modcod ?? vs?.modcod ?? meter.bandLabel
    );

    return {
      tileId: 'probe',
      heroLabel: '8 GHz SINR',
      heroValue: `${sinrVal.toFixed(1)} dB`,
      statusLabel: `${statusWord} · ${meter.bandLabel}`,
      tone,
      meterPct: meter.fillPct,
      metrics: [
        { label: 'MODCOD', value: modcod.replace('LINK_', '') },
        { label: 'Slant', value: Number.isFinite(slantKm) ? `${slantKm.toFixed(1)} km` : '--' },
        { label: 'Elev Ang', value: Number.isFinite(elevAng) ? `${elevAng >= 0 ? '+' : ''}${elevAng.toFixed(1)}°` : '--' },
        { label: 'Sky Open', value: Number.isFinite(skyPct) ? `${Math.round(skyPct)}%` : '--' },
      ],
      footerHint: 'Use Snap Peak to jump to best nearby crest.',
    };
  }

  if (tileId === 'region') {
    const box = input.aoSwathBox;
    const rep = input.aoSwathReport;
    const hasScan = Boolean(box && rep && Number.isFinite(rep.losCoveragePct));
    if (!hasScan) {
      return {
        tileId: 'region',
        heroLabel: 'LoS Coverage',
        heroValue: '-- %',
        statusLabel: 'No Scan',
        tone: 'neutral',
        metrics: [
          { label: 'Area', value: '--' },
          { label: 'Mean SINR', value: '--' },
          { label: 'Blocked', value: '--' },
          { label: 'Relief', value: '--' },
        ],
        footerHint: 'Choose a quick box (6×6 / 12×12 / 20×20 km).',
      };
    }

    const dims = computeAoSwathEdgeDimensions(box);
    const cov = computeQgisCoverageBreakdown(rep.losCoveragePct, rep.deadZonePct ?? 0);
    const meanSinr = Number(rep.meanSinrDb ?? NaN);
    const summitM = Number(rep.summitPeak?.zMslM ?? rep.maxElevM ?? NaN);
    const valleyM = Number(rep.valleyFloor?.zMslM ?? rep.minElevM ?? NaN);
    const reliefStr =
      Number.isFinite(summitM) && Number.isFinite(valleyM)
        ? `${Math.round(summitM - valleyM)} m`
        : '--';
    const tone: WorkspaceTileTone =
      cov.clearPct >= 65 ? 'clear' : cov.clearPct >= 30 ? 'marginal' : 'blocked';

    return {
      tileId: 'region',
      heroLabel: 'LoS Coverage',
      heroValue: `${Math.round(rep.losCoveragePct)}%`,
      statusLabel: `${dims.areaKm2.toFixed(0)} km²`,
      tone,
      coverageBar: cov,
      metrics: [
        { label: 'Box Size', value: `${dims.widthKm.toFixed(0)}×${dims.heightKm.toFixed(0)} km` },
        { label: 'Mean SINR', value: Number.isFinite(meanSinr) ? `${meanSinr.toFixed(1)} dB` : '--' },
        { label: 'Blocked', value: `${Math.round(cov.deadZonePct)}%` },
        { label: 'Relief', value: reliefStr },
      ],
      footerHint: 'Drag amber box corners on map to re-scan.',
    };
  }

  // tileId === 'obstacle'
  const obstacles = Array.isArray(input.obstacles) ? input.obstacles : [];
  const selected =
    (input.obsSelectedId != null
      ? obstacles.find((o) => String(o?.id) === String(input.obsSelectedId))
      : null) ?? obstacles[obstacles.length - 1] ?? null;
  const rep = input.cadObstacleReport;

  if (!selected) {
    return {
      tileId: 'obstacle',
      heroLabel: 'Active Barrier',
      heroValue: 'None',
      statusLabel: '0 Placed',
      tone: 'neutral',
      metrics: [
        { label: 'Height', value: '--' },
        { label: 'Links Hit', value: '0' },
        { label: 'Blocked', value: '0' },
        { label: 'Need H', value: '--' },
      ],
      footerHint: 'Click Block Link or drag a wall on map.',
    };
  }

  const lenM = Math.max(
    Number(selected.depthM ?? selected.depth_m ?? selected.length_m ?? 0),
    Number(selected.widthM ?? selected.width_m ?? 0)
  );
  const heightM = Number(selected.heightM ?? selected.height_m ?? 250);
  const crossed = Array.isArray(rep?.intersections) ? rep.intersections.length : 0;
  const blockedCount = Array.isArray(rep?.slicedNodeIds) ? rep.slicedNodeIds.length : 0;
  const reqH = Number(rep?.maxRequiredHeightToSliceAllM ?? NaN);
  const crestM = Number(rep?.midTopElevM ?? NaN);
  const tone: WorkspaceTileTone =
    blockedCount > 0 ? 'blocked' : crossed > 0 ? 'marginal' : 'clear';
  const statusLabel =
    crossed === 0
      ? `${obstacles.length} Placed · Clear`
      : `${blockedCount}/${crossed} Blocked`;

  return {
    tileId: 'obstacle',
    heroLabel: 'Active Barrier',
    heroValue: `${(lenM / 1000).toFixed(2)} km`,
    statusLabel,
    tone,
    metrics: [
      { label: 'Height', value: Number.isFinite(heightM) ? `${Math.round(heightM)} m` : '--' },
      { label: 'Crest MSL', value: Number.isFinite(crestM) ? `${Math.round(crestM)} m` : '--' },
      { label: 'Links Hit', value: `${crossed} (${blockedCount} blk)` },
      { label: 'Need H', value: Number.isFinite(reqH) && reqH > 0 ? `${Math.round(reqH)} m` : '--' },
    ],
    footerHint: 'Use Auto-Size to slice intersected links.',
  };
}

// ============================================================================
// Monochrome SVG Icons (Zero Emojis)
// ============================================================================

const TILE_ICONS: Record<WorkspaceTileId, string> = {
  dem: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polygon points="15.8 8.2 13.7 13.7 8.2 15.8 10.3 10.3 15.8 8.2"/></svg>',
  transect: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18L18 4"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="5" r="2"/></svg>',
  probe: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  region: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9 4v16M15 4v16M4 9h16M4 15h16"/></svg>',
  obstacle: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
};

const TILES_GRID_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/></svg>';

// ============================================================================
// Interactive DOM Controller
// ============================================================================

export interface WorkspaceTilesManagerDeps {
  readonly getTelemetryInput: () => WorkspaceTilesTelemetryInput;
  readonly onActivateTool: (mode: WorkspaceTileId, autoArm: boolean) => void;
  readonly onOpenInspector: (mode: WorkspaceTileId) => void;
  readonly onApplyDemPreset: (presetId: string) => void;
  readonly onFitDem: () => void;
  readonly onStartMeasureTwoPoint: () => void;
  readonly onSwapTransect: () => void;
  readonly onClearMeasure: () => void;
  readonly onArmProbePick: () => void;
  readonly onProbeSnapBest: () => void;
  readonly onClearProbe: () => void;
  readonly onQuickAoBox: (sizeKm: number) => void;
  readonly onArmRegionDraw: () => void;
  readonly onArmObstaclePlace: () => void;
  readonly onBlockFirstNodeLink: () => void;
  readonly onAutoSizeObstacle: () => void;
}

export interface WorkspaceTilesManager {
  readonly mount: () => void;
  readonly sync: () => void;
  readonly setEnabled: (enabled: boolean) => void;
  readonly toggle: () => void;
  readonly getState: () => WorkspaceTilesState;
  readonly destroy: () => void;
}

export function createWorkspaceTilesManager(
  deps: WorkspaceTilesManagerDeps
): WorkspaceTilesManager {
  let state: WorkspaceTilesState = createDefaultWorkspaceTilesState();
  let mounted = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastRenderKey = '';
  let lastBarKey = '';
  let lastCols = -1;
  let lastSyncedEnabled: boolean | null = null;
  let boundOnResize: (() => void) | null = null;
  let boundOnVisibility: (() => void) | null = null;

  let overlayEl: HTMLDivElement | null = null;
  let gridEl: HTMLDivElement | null = null;
  let toolbarBtnEl: HTMLButtonElement | null = null;
  let tbHeaderBtnEl: HTMLButtonElement | null = null;

  const loadPersisted = (): WorkspaceTilesState => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(WORKSPACE_TILES_STORAGE_KEY) : null;
      const loaded = deserializeWorkspaceTilesState(raw);
      // Always start clean on initial page load unless user toggles it on,
      // while preserving their preferred layout & pinned tile selection.
      return { ...loaded, enabled: false };
    } catch {
      return createDefaultWorkspaceTilesState();
    }
  };

  const persistState = (): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(WORKSPACE_TILES_STORAGE_KEY, serializeWorkspaceTilesState(state));
      }
    } catch {
      // Ignore storage quota / private mode failures
    }
  };

  const syncTriggerButtons = (): void => {
    if (lastSyncedEnabled === state.enabled) return;
    lastSyncedEnabled = state.enabled;
    if (toolbarBtnEl) {
      toolbarBtnEl.classList.toggle('active', state.enabled);
      toolbarBtnEl.setAttribute('aria-pressed', String(state.enabled));
    }
    if (tbHeaderBtnEl) {
      tbHeaderBtnEl.classList.toggle('active', state.enabled);
      tbHeaderBtnEl.setAttribute('aria-pressed', String(state.enabled));
    }
    const container = typeof document !== 'undefined' ? document.getElementById('radar-container') : null;
    if (container) {
      container.setAttribute('data-workspace-tiles', state.enabled ? 'true' : 'false');
    }
  };

  const renderTileActionsHtml = (tileId: WorkspaceTileId): string => {
    if (tileId === 'dem') {
      return `
        <button type="button" class="ws-tile-act" data-ws-action="dem-ladakh">Ladakh</button>
        <button type="button" class="ws-tile-act" data-ws-action="dem-kargil">Kargil</button>
        <button type="button" class="ws-tile-act" data-ws-action="dem-thar">Thar</button>
        <button type="button" class="ws-tile-act is-primary" data-ws-action="dem-fit">Fit</button>
      `;
    }
    if (tileId === 'transect') {
      return `
        <button type="button" class="ws-tile-act is-primary" data-ws-action="transect-measure">Measure A → B</button>
        <button type="button" class="ws-tile-act" data-ws-action="transect-swap">Swap</button>
        <button type="button" class="ws-tile-act" data-ws-action="transect-clear">Clear</button>
      `;
    }
    if (tileId === 'probe') {
      return `
        <button type="button" class="ws-tile-act is-primary" data-ws-action="probe-pick">Pick Site</button>
        <button type="button" class="ws-tile-act" data-ws-action="probe-snap">Snap Peak</button>
        <button type="button" class="ws-tile-act" data-ws-action="probe-clear">Clear</button>
      `;
    }
    if (tileId === 'region') {
      return `
        <button type="button" class="ws-tile-act" data-ws-action="region-6">6×6</button>
        <button type="button" class="ws-tile-act is-primary" data-ws-action="region-12">12×12</button>
        <button type="button" class="ws-tile-act" data-ws-action="region-20">20×20</button>
        <button type="button" class="ws-tile-act" data-ws-action="region-draw">Draw</button>
      `;
    }
    return `
      <button type="button" class="ws-tile-act" data-ws-action="obs-place">Place</button>
      <button type="button" class="ws-tile-act is-primary" data-ws-action="obs-block">Block Link</button>
      <button type="button" class="ws-tile-act" data-ws-action="obs-auto">Auto H</button>
    `;
  };

  const renderTileCardHtml = (
    tileId: WorkspaceTileId,
    telemetry: WorkspaceTileTelemetry,
    index: number,
    total: number,
    activeMode: string | undefined
  ): string => {
    const meta = WORKSPACE_TILE_META[tileId];
    const isCollapsed = state.collapsedTiles.includes(tileId);
    const isActiveTool = activeMode === tileId || state.focusedTile === tileId;

    let visualStripHtml = '';
    if (typeof telemetry.meterPct === 'number') {
      visualStripHtml = `
        <div class="ws-tile-meter" aria-hidden="true">
          <div class="ws-tile-meter-fill is-${telemetry.tone}" style="width:${Math.max(0, Math.min(100, telemetry.meterPct))}%"></div>
        </div>
      `;
    } else if (telemetry.coverageBar) {
      const c = telemetry.coverageBar;
      visualStripHtml = `
        <div class="ws-tile-covbar" aria-hidden="true">
          <span class="ws-cov-clear" style="width:${c.clearPct}%"></span>
          <span class="ws-cov-weak" style="width:${c.marginalPct}%"></span>
          <span class="ws-cov-blocked" style="width:${c.deadZonePct}%"></span>
        </div>
      `;
    }

    const metricsHtml = telemetry.metrics
      .map(
        (m) => `
        <div class="ws-tile-kv">
          <span class="ws-tile-k">${escapeHtml(m.label)}</span>
          <strong class="ws-tile-v">${escapeHtml(m.value)}</strong>
        </div>
      `
      )
      .join('');

    return `
      <section class="ws-tile is-${meta.accentVar}" data-tile-id="${tileId}" data-active-tool="${isActiveTool ? 'true' : 'false'}" data-collapsed="${isCollapsed ? 'true' : 'false'}" aria-label="${escapeHtml(meta.title)} telemetry tile">
        <header class="ws-tile-head">
          <button type="button" class="ws-tile-title-btn" data-ws-focus="${tileId}" title="Activate ${escapeHtml(meta.title)} on map (${meta.hotkey})">
            <span class="ws-tile-icon">${TILE_ICONS[tileId]}</span>
            <span class="ws-tile-title">${escapeHtml(meta.title)}</span>
          </button>
          <div class="ws-tile-controls">
            <button type="button" class="ws-tile-icon-btn" data-ws-move-left="${tileId}" ${index === 0 ? 'disabled' : ''} title="Move tile left" aria-label="Move ${escapeHtml(meta.title)} left">&lsaquo;</button>
            <button type="button" class="ws-tile-icon-btn" data-ws-move-right="${tileId}" ${index === total - 1 ? 'disabled' : ''} title="Move tile right" aria-label="Move ${escapeHtml(meta.title)} right">&rsaquo;</button>
            <button type="button" class="ws-tile-icon-btn" data-ws-collapse="${tileId}" title="${isCollapsed ? 'Expand tile' : 'Collapse tile'}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escapeHtml(meta.title)}">${isCollapsed ? '+' : '&minus;'}</button>
            <button type="button" class="ws-tile-icon-btn" data-ws-inspect="${tileId}" title="Open full ${escapeHtml(meta.title)} panel" aria-label="Open full ${escapeHtml(meta.title)} inspector">&#8599;</button>
            <button type="button" class="ws-tile-icon-btn is-close" data-ws-close="${tileId}" title="Close tile" aria-label="Close ${escapeHtml(meta.title)} tile">&times;</button>
          </div>
        </header>
        <div class="ws-tile-body">
          <div class="ws-tile-hero">
            <div class="ws-tile-hero-meta">
              <span class="ws-tile-hero-label">${escapeHtml(telemetry.heroLabel)}</span>
              <span class="ws-tile-status is-${telemetry.tone}">${escapeHtml(telemetry.statusLabel)}</span>
            </div>
            <strong class="ws-tile-hero-value is-${telemetry.tone}">${escapeHtml(telemetry.heroValue)}</strong>
          </div>
          ${visualStripHtml}
          <div class="ws-tile-grid-kv">${metricsHtml}</div>
          <div class="ws-tile-actions">${renderTileActionsHtml(tileId)}</div>
        </div>
      </section>
    `;
  };

  const renderControlBarHtml = (): string => {
    const toolToggles = WORKSPACE_TILE_ORDER.map((id) => {
      const meta = WORKSPACE_TILE_META[id];
      const active = state.openTiles.includes(id);
      return `<button type="button" class="ws-bar-tool-btn is-${meta.accentVar}${active ? ' is-open' : ''}" data-ws-toggle-tile="${id}" aria-pressed="${active ? 'true' : 'false'}" title="Show or hide ${escapeHtml(meta.title)} tile">${escapeHtml(meta.shortLabel)}</button>`;
    }).join('');

    const presetBtns = WORKSPACE_TILE_PRESETS.map((p) => {
      const isCurrent =
        state.layout === p.layout &&
        state.openTiles.length === p.tiles.length &&
        p.tiles.every((t, i) => state.openTiles[i] === t);
      return `<button type="button" class="ws-bar-seg-btn${isCurrent ? ' is-active' : ''}" data-ws-preset="${p.id}" aria-pressed="${isCurrent ? 'true' : 'false'}">${escapeHtml(p.label)}</button>`;
    }).join('');

    return `
      <div class="ws-bar-left">
        <span class="ws-bar-heading">${TILES_GRID_ICON}<span>Tiles</span></span>
        <div class="ws-bar-tools" role="group" aria-label="Toggle telemetry tiles">${toolToggles}</div>
      </div>
      <div class="ws-bar-right">
        <div class="ws-bar-seg" role="group" aria-label="Tile presets">${presetBtns}</div>
        <div class="ws-bar-seg" role="group" aria-label="Tile arrangement">
          <button type="button" class="ws-bar-seg-btn${state.layout === 'row' ? ' is-active' : ''}" data-ws-layout="row" aria-pressed="${state.layout === 'row' ? 'true' : 'false'}">Row</button>
          <button type="button" class="ws-bar-seg-btn${state.layout === 'grid' ? ' is-active' : ''}" data-ws-layout="grid" aria-pressed="${state.layout === 'grid' ? 'true' : 'false'}">Grid</button>
        </div>
        <button type="button" class="ws-bar-close" data-ws-close-all="true" title="Close Workspace Tiles" aria-label="Close Workspace Tiles">Done</button>
      </div>
    `;
  };

  const computeDirtySignature = (
    cols: number,
    input: WorkspaceTilesTelemetryInput
  ): string => {
    const parts: string[] = [
      state.enabled ? '1' : '0',
      state.layout,
      state.focusedTile,
      state.openTiles.join(','),
      state.collapsedTiles.join(','),
      String(cols),
      String(input.activeMode ?? ''),
    ];
    for (let i = 0; i < state.openTiles.length; i++) {
      const id = state.openTiles[i];
      if (id === 'dem') {
        parts.push(
          'd',
          String(input.terrainSector ?? ''),
          String(input.terrainSource ?? ''),
          String(input.radarRangeM ?? ''),
          String(input.backdropMode ?? ''),
          String(input.terrainElevMinM ?? ''),
          String(input.terrainElevMaxM ?? ''),
          String(input.terrainGridSize ?? ''),
          String(input.groundNodeCount ?? '')
        );
      } else if (id === 'transect') {
        const res = input.transectResult;
        const rm = input.rulerMetrics;
        const rev = input.rulerEvaluation;
        parts.push(
          't',
          String(res?.totalHorizontalM ?? rm?.horizontalDistanceM ?? ''),
          String(rm?.azimuthDeg ?? res?.azimuthDeg ?? rm?.bearingDeg ?? ''),
          String(rm?.cardinalOctant ?? ''),
          String(rm?.groundElevationDeltaM ?? rm?.deltaZM ?? rm?.antennaElevationDeltaM ?? rm?.elevationDeltaM ?? res?.elevDeltaM ?? rm?.elevDeltaM ?? ''),
          String(res?.minFresnelClearanceM ?? rev?.minFresnelClearanceM ?? rev?.minClearanceM ?? ''),
          String(res?.estSnrDb ?? rev?.estSnrDb ?? ''),
          String(rev?.isLineOfSightClear ?? res?.isObstructed ?? rev?.isLos ?? ''),
          String(input.transectSnrLabel ?? ''),
          String(input.transectFresnelLabel ?? '')
        );
      } else if (id === 'probe') {
        const live = input.cursorProbeLive;
        const vs = input.viewshedResult;
        parts.push(
          'p',
          input.probeSite ? '1' : '0',
          String(live?.estSinrDb ?? vs?.acnLink?.estSinrDb ?? vs?.estSinrDb ?? ''),
          String(live?.isLos ?? vs?.acnLink?.isLos ?? vs?.isLos ?? ''),
          String(live?.d3dKm ?? vs?.acnLink?.slantRangeM ?? vs?.slantRangeM ?? ''),
          String(live?.elToAcnDeg ?? vs?.acnLink?.elevationAngleDeg ?? vs?.elevationAngleDeg ?? ''),
          String(live?.skyOpennessPct ?? vs?.skyOpenPct ?? vs?.openSkyPct ?? ''),
          String(live?.modcodName ?? vs?.acnLink?.modcod ?? vs?.modcod ?? '')
        );
      } else if (id === 'region') {
        const box = input.aoSwathBox;
        const rep = input.aoSwathReport;
        parts.push(
          'r',
          box ? `${box.x1},${box.y1},${box.x2},${box.y2}` : '0',
          String(rep?.losCoveragePct ?? ''),
          String(rep?.deadZonePct ?? ''),
          String(rep?.meanSinrDb ?? ''),
          String(rep?.summitPeak?.zMslM ?? rep?.maxElevM ?? ''),
          String(rep?.valleyFloor?.zMslM ?? rep?.minElevM ?? '')
        );
      } else {
        const obsList = Array.isArray(input.obstacles) ? input.obstacles : [];
        const sel =
          (input.obsSelectedId != null
            ? obsList.find((o) => String(o?.id) === String(input.obsSelectedId))
            : null) ??
          obsList[obsList.length - 1] ??
          null;
        const rep = input.cadObstacleReport;
        parts.push(
          'o',
          String(obsList.length),
          String(sel?.id ?? ''),
          String(sel?.depthM ?? sel?.depth_m ?? sel?.length_m ?? ''),
          String(sel?.widthM ?? sel?.width_m ?? ''),
          String(sel?.heightM ?? sel?.height_m ?? ''),
          String(Array.isArray(rep?.intersections) ? rep.intersections.length : 0),
          String(Array.isArray(rep?.slicedNodeIds) ? rep.slicedNodeIds.length : 0),
          String(rep?.maxRequiredHeightToSliceAllM ?? ''),
          String(rep?.midTopElevM ?? '')
        );
      }
    }
    return parts.join('|');
  };

  const sync = (): void => {
    if (!mounted || !overlayEl || !gridEl) return;
    syncTriggerButtons();

    const input = deps.getTelemetryInput();
    const is3d = input.stageViewMode === '3d';
    const shouldShow = state.enabled && !is3d;
    if (overlayEl.hidden !== !shouldShow) {
      overlayEl.hidden = !shouldShow;
    }
    if (!shouldShow) {
      lastRenderKey = '';
      lastBarKey = '';
      lastCols = -1;
      return;
    }

    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }

    const containerWidth = overlayEl.parentElement?.clientWidth ?? 820;
    const cols = computeWorkspaceGridColumns(state.openTiles.length, state.layout, containerWidth - 68);
    const renderKey = computeDirtySignature(cols, input);
    if (renderKey === lastRenderKey) {
      return;
    }
    lastRenderKey = renderKey;

    if (overlayEl.getAttribute('data-ws-layout') !== state.layout) {
      overlayEl.setAttribute('data-ws-layout', state.layout);
    }
    if (cols !== lastCols) {
      gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      lastCols = cols;
    }

    const snapshots = state.openTiles.map((id) => buildWorkspaceTileTelemetry(id, input));

    const barEl = overlayEl.querySelector('#workspace-tiles-bar');
    const barKey = `${state.layout}:${state.openTiles.join(',')}`;
    if (barEl && barKey !== lastBarKey) {
      const hasFocusInBar =
        typeof document !== 'undefined' &&
        Boolean(document.activeElement) &&
        barEl.contains(document.activeElement);
      if (hasFocusInBar && barEl.children.length > 0) {
        // Sync active/pressed states in-place to preserve keyboard focus
        barEl.querySelectorAll<HTMLButtonElement>('[data-ws-toggle-tile]').forEach((btn) => {
          const id = btn.dataset.wsToggleTile;
          const active = Boolean(id && state.openTiles.includes(id as WorkspaceTileId));
          btn.classList.toggle('is-open', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        barEl.querySelectorAll<HTMLButtonElement>('[data-ws-preset]').forEach((btn) => {
          const preset = WORKSPACE_TILE_PRESETS.find((p) => p.id === btn.dataset.wsPreset);
          const isCurrent = Boolean(
            preset &&
              state.layout === preset.layout &&
              state.openTiles.length === preset.tiles.length &&
              preset.tiles.every((t, i) => state.openTiles[i] === t)
          );
          btn.classList.toggle('is-active', isCurrent);
          btn.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
        });
        barEl.querySelectorAll<HTMLButtonElement>('[data-ws-layout]').forEach((btn) => {
          const isCurrent = btn.dataset.wsLayout === state.layout;
          btn.classList.toggle('is-active', isCurrent);
          btn.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
        });
      } else {
        barEl.innerHTML = renderControlBarHtml();
      }
      lastBarKey = barKey;
    }
    gridEl.innerHTML = snapshots
      .map((snap, idx) => renderTileCardHtml(snap.tileId, snap, idx, snapshots.length, input.activeMode))
      .join('');
  };

  const handleAction = (action: string): void => {
    switch (action) {
      case 'dem-ladakh':
        state = setWorkspaceFocusedTile(state, 'dem');
        deps.onApplyDemPreset('ladakh');
        break;
      case 'dem-kargil':
        state = setWorkspaceFocusedTile(state, 'dem');
        deps.onApplyDemPreset('kargil');
        break;
      case 'dem-thar':
        state = setWorkspaceFocusedTile(state, 'dem');
        deps.onApplyDemPreset('arid_desert');
        break;
      case 'dem-fit':
        state = setWorkspaceFocusedTile(state, 'dem');
        deps.onFitDem();
        break;
      case 'transect-measure':
        state = setWorkspaceFocusedTile(state, 'transect');
        deps.onActivateTool('transect', false);
        deps.onStartMeasureTwoPoint();
        break;
      case 'transect-swap':
        state = setWorkspaceFocusedTile(state, 'transect');
        deps.onSwapTransect();
        break;
      case 'transect-clear':
        state = setWorkspaceFocusedTile(state, 'transect');
        deps.onClearMeasure();
        break;
      case 'probe-pick':
        state = setWorkspaceFocusedTile(state, 'probe');
        deps.onActivateTool('probe', false);
        deps.onArmProbePick();
        break;
      case 'probe-snap':
        state = setWorkspaceFocusedTile(state, 'probe');
        deps.onProbeSnapBest();
        break;
      case 'probe-clear':
        state = setWorkspaceFocusedTile(state, 'probe');
        deps.onClearProbe();
        break;
      case 'region-6':
        state = setWorkspaceFocusedTile(state, 'region');
        deps.onActivateTool('region', false);
        deps.onQuickAoBox(6);
        break;
      case 'region-12':
        state = setWorkspaceFocusedTile(state, 'region');
        deps.onActivateTool('region', false);
        deps.onQuickAoBox(12);
        break;
      case 'region-20':
        state = setWorkspaceFocusedTile(state, 'region');
        deps.onActivateTool('region', false);
        deps.onQuickAoBox(20);
        break;
      case 'region-draw':
        state = setWorkspaceFocusedTile(state, 'region');
        deps.onActivateTool('region', false);
        deps.onArmRegionDraw();
        break;
      case 'obs-place':
        state = setWorkspaceFocusedTile(state, 'obstacle');
        deps.onActivateTool('obstacle', false);
        deps.onArmObstaclePlace();
        break;
      case 'obs-block':
        state = setWorkspaceFocusedTile(state, 'obstacle');
        deps.onActivateTool('obstacle', false);
        deps.onBlockFirstNodeLink();
        break;
      case 'obs-auto':
        state = setWorkspaceFocusedTile(state, 'obstacle');
        deps.onAutoSizeObstacle();
        break;
      default:
        break;
    }
    sync();
  };

  const handleOverlayClick = (ev: Event): void => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    ev.stopPropagation();

    if (btn.dataset.wsCloseAll === 'true') {
      setEnabled(false);
      return;
    }
    if (btn.dataset.wsToggleTile && isWorkspaceTileId(btn.dataset.wsToggleTile)) {
      state = toggleWorkspaceTile(state, btn.dataset.wsToggleTile);
      persistState();
      sync();
      return;
    }
    if (btn.dataset.wsPreset) {
      state = applyWorkspaceTilesPreset(state, btn.dataset.wsPreset as WorkspaceTilesPresetId);
      persistState();
      sync();
      return;
    }
    if (btn.dataset.wsLayout === 'row' || btn.dataset.wsLayout === 'grid') {
      state = setWorkspaceTilesLayout(state, btn.dataset.wsLayout);
      persistState();
      sync();
      return;
    }
    if (btn.dataset.wsFocus && isWorkspaceTileId(btn.dataset.wsFocus)) {
      state = setWorkspaceFocusedTile(state, btn.dataset.wsFocus);
      deps.onActivateTool(btn.dataset.wsFocus, btn.dataset.wsFocus !== 'dem');
      persistState();
      sync();
      return;
    }
    if (btn.dataset.wsMoveLeft && isWorkspaceTileId(btn.dataset.wsMoveLeft)) {
      state = moveWorkspaceTile(state, btn.dataset.wsMoveLeft, -1);
      persistState();
      sync();
      return;
    }
    if (btn.dataset.wsMoveRight && isWorkspaceTileId(btn.dataset.wsMoveRight)) {
      state = moveWorkspaceTile(state, btn.dataset.wsMoveRight, 1);
      persistState();
      sync();
      return;
    }
    if (btn.dataset.wsCollapse && isWorkspaceTileId(btn.dataset.wsCollapse)) {
      state = toggleWorkspaceTileCollapsed(state, btn.dataset.wsCollapse);
      persistState();
      sync();
      return;
    }
    if (btn.dataset.wsInspect && isWorkspaceTileId(btn.dataset.wsInspect)) {
      state = setWorkspaceFocusedTile(state, btn.dataset.wsInspect);
      deps.onOpenInspector(btn.dataset.wsInspect);
      sync();
      return;
    }
    if (btn.dataset.wsClose && isWorkspaceTileId(btn.dataset.wsClose)) {
      state = closeWorkspaceTile(state, btn.dataset.wsClose);
      persistState();
      sync();
      return;
    }
    if (btn.dataset.wsAction) {
      handleAction(btn.dataset.wsAction);
    }
  };

  const setEnabled = (enabled: boolean): void => {
    state = toggleWorkspaceTilesEnabled(state, enabled);
    persistState();
    lastRenderKey = '';
    sync();
    if (state.enabled && !pollTimer) {
      pollTimer = setInterval(() => {
        if (state.enabled && (typeof document === 'undefined' || !document.hidden)) sync();
      }, 220);
    } else if (!state.enabled && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const toggle = (): void => setEnabled(!state.enabled);

  const mount = (): void => {
    if (mounted || typeof document === 'undefined') return;
    mounted = true;
    state = loadPersisted();

    // 1. Mount primary "Tiles" toggle button inside the map utility toolbar
    const legendBtn = document.getElementById('btn-legend-toggle');
    if (legendBtn && legendBtn.parentElement && !document.getElementById('btn-workspace-tiles-toggle')) {
      const btn = document.createElement('button');
      btn.id = 'btn-workspace-tiles-toggle';
      btn.type = 'button';
      btn.className = 'btn-workspace-tiles-toggle';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'Toggle Workspace Tiles multi-tool overlay');
      btn.title = 'Workspace Tiles: monitor multiple tool panels side-by-side on the radar map';
      btn.innerHTML = `${TILES_GRID_ICON}<span>Tiles</span>`;
      btn.addEventListener('click', toggle);
      legendBtn.parentElement.insertBefore(btn, legendBtn);
      toolbarBtnEl = btn;
    }

    // 2. Mount secondary "Tiles" toggle button inside Terrain Toolbox header actions
    const tbActions = document.querySelector('#terrain-toolbox .tb-view-header-actions');
    const navBtn = document.getElementById('tb-navigate-btn');
    if (tbActions && !document.getElementById('tb-workspace-tiles-btn')) {
      const btn = document.createElement('button');
      btn.id = 'tb-workspace-tiles-btn';
      btn.type = 'button';
      btn.className = 'tb-btn-tiles';
      btn.setAttribute('aria-pressed', 'false');
      btn.title = 'Display multiple tool telemetry panels side-by-side on the radar map';
      btn.innerHTML = `${TILES_GRID_ICON}<span>Tiles</span>`;
      btn.addEventListener('click', toggle);
      if (navBtn && navBtn.parentElement === tbActions) {
        tbActions.insertBefore(btn, navBtn);
      } else {
        tbActions.prepend(btn);
      }
      tbHeaderBtnEl = btn;
    }

    // 3. Mount docked Workspace Tiles overlay inside #radar-container
    const radarContainer = document.getElementById('radar-container');
    if (radarContainer && !document.getElementById('workspace-tiles-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'workspace-tiles-overlay';
      overlay.className = 'workspace-tiles-overlay';
      overlay.setAttribute('role', 'region');
      overlay.setAttribute('aria-label', 'Workspace Tiles concurrent telemetry panels');
      overlay.hidden = true;
      overlay.innerHTML = `
        <div id="workspace-tiles-bar" class="workspace-tiles-bar"></div>
        <div id="workspace-tiles-grid" class="workspace-tiles-grid"></div>
      `;
      // Stop pointer events inside the dock from triggering radar pan/click underneath
      overlay.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement)?.closest('.workspace-tiles-bar, .ws-tile')) {
          e.stopPropagation();
        }
      });
      overlay.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement)?.closest('.workspace-tiles-bar, .ws-tile')) {
          e.stopPropagation();
        }
      });
      overlay.addEventListener('wheel', (e) => {
        if ((e.target as HTMLElement)?.closest('.workspace-tiles-bar, .ws-tile')) {
          e.stopPropagation();
        }
      }, { passive: true });
      overlay.addEventListener('click', handleOverlayClick);

      radarContainer.appendChild(overlay);
      overlayEl = overlay;
      gridEl = overlay.querySelector('#workspace-tiles-grid');
    }

    if (typeof window !== 'undefined') {
      (window as any).workspaceTilesManager = api;
      if (!boundOnResize) {
        boundOnResize = () => {
          if (state.enabled) {
            lastRenderKey = '';
            sync();
          }
        };
        window.addEventListener('resize', boundOnResize);
      }
      if (!boundOnVisibility && typeof document !== 'undefined') {
        boundOnVisibility = () => {
          if (state.enabled && !document.hidden) {
            sync();
          }
        };
        document.addEventListener('visibilitychange', boundOnVisibility);
      }
    }

    sync();
  };

  const destroy = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (boundOnResize && typeof window !== 'undefined') {
      window.removeEventListener('resize', boundOnResize);
      boundOnResize = null;
    }
    if (boundOnVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', boundOnVisibility);
      boundOnVisibility = null;
    }
    overlayEl?.remove();
    toolbarBtnEl?.remove();
    tbHeaderBtnEl?.remove();
    mounted = false;
  };

  const api: WorkspaceTilesManager = {
    mount,
    sync,
    setEnabled,
    toggle,
    getState: () => state,
    destroy,
  };

  return api;
}
