/**
 * Centralized Map Layer Registry for the Tactical X-Band Digital Twin.
 *
 * Manages 17 authentic telemetry- and DEM-backed layers across 5 categories,
 * presets, category master states, opacity persistence, Zoom-LOD tiers,
 * and read-time contextual focus evaluation without mutating user preferences.
 */

import { HIGHLAND_THEME } from './chartTheme';

export const MAP_LAYER_STORAGE_KEY = 'xband-map-layers-v1';

export type MapLayerCategoryId = 'base' | 'entities' | 'comm' | 'rf' | 'eng';

export type MapLayerId =
  | 'base.terrainDem'
  | 'base.contours'
  | 'base.demBoundary'
  | 'base.rangeGrid'
  | 'entities.acn'
  | 'entities.groundNodes'
  | 'entities.labels'
  | 'entities.trajectory'
  | 'entities.obstacles'
  | 'comm.links'
  | 'comm.transmissions'
  | 'comm.coverage'
  | 'rf.losAnalysis'
  | 'rf.fresnelZone'
  | 'rf.obstructionPoints'
  | 'rf.signalQuality'
  | 'eng.measurements';

export type MapLayerPresetId = 'operational' | 'rf_analysis' | 'minimal' | 'all';

export type MapRendererTarget = 'radar' | 'maplibre' | 'three';

export type MapZoomLodTier = 'distant' | 'medium' | 'close';

export interface MapLayerCategoryDef {
  readonly id: MapLayerCategoryId;
  readonly code: 'A' | 'B' | 'C' | 'D' | 'E';
  readonly label: string;
}

export interface MapLayerDefinition {
  readonly id: MapLayerId;
  readonly category: MapLayerCategoryId;
  readonly label: string;
  readonly defaultVisible: boolean;
  readonly supportsOpacity: boolean;
  readonly defaultOpacity: number;
  readonly targets: readonly MapRendererTarget[];
  readonly scopeTag?: '2D / Geo' | '2D' | '2D / 3D';
  readonly swatchColor: string;
  readonly zoomLod?: boolean;
}

export interface MapLayerStateEntry {
  visible: boolean;
  opacity: number;
}

export interface ContextualMapContext {
  selectedNodeId?: number | null;
  isTrajectoryEditing?: boolean;
  isObstacleEditing?: boolean;
  contextualFocusEnabled?: boolean;
  zoomRangeM?: number;
}

export interface CategoryToggleState {
  checked: boolean;
  indeterminate: boolean;
  enabledCount: number;
  totalCount: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const MAP_LAYER_CATEGORIES: readonly MapLayerCategoryDef[] = [
  { id: 'base', code: 'A', label: 'Base Map' },
  { id: 'entities', code: 'B', label: 'Network Entities' },
  { id: 'comm', code: 'C', label: 'Communication' },
  { id: 'rf', code: 'D', label: 'RF & Propagation Analysis' },
  { id: 'eng', code: 'E', label: 'Engineering Overlays' },
];

export const MAP_LAYER_DEFINITIONS: readonly MapLayerDefinition[] = [
  // Category A — Base Map
  {
    id: 'base.terrainDem',
    category: 'base',
    label: 'Terrain Hillshade / HGT',
    defaultVisible: true,
    supportsOpacity: true,
    defaultOpacity: 0.90,
    targets: ['radar', 'maplibre', 'three'],
    scopeTag: '2D / Geo',
    swatchColor: HIGHLAND_THEME.signal.sage,
  },
  {
    id: 'base.contours',
    category: 'base',
    label: 'Topographic Ridge Spines & Summits',
    defaultVisible: false,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar'],
    scopeTag: '2D',
    swatchColor: HIGHLAND_THEME.cartography.contour,
  },
  {
    id: 'base.demBoundary',
    category: 'base',
    label: 'DEM Coverage Footprint',
    defaultVisible: false,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar'],
    scopeTag: '2D',
    swatchColor: HIGHLAND_THEME.cartography.demBracket,
  },
  {
    id: 'base.rangeGrid',
    category: 'base',
    label: 'Range Rings & Crosshairs',
    defaultVisible: false,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar', 'three'],
    scopeTag: '2D / 3D',
    swatchColor: HIGHLAND_THEME.cartography.rangeLabel,
  },
  // Category B — Network Entities
  {
    id: 'entities.acn',
    category: 'entities',
    label: 'Airborne Relay (ACN-1) & Vector',
    defaultVisible: true,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar', 'maplibre', 'three'],
    swatchColor: HIGHLAND_THEME.signal.amber,
  },
  {
    id: 'entities.groundNodes',
    category: 'entities',
    label: 'Ground Terminals (MCP & Soldiers)',
    defaultVisible: true,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar', 'maplibre', 'three'],
    swatchColor: HIGHLAND_THEME.signal.sage,
  },
  {
    id: 'entities.labels',
    category: 'entities',
    label: 'Callsigns & Telemetry Tags',
    defaultVisible: true,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar', 'maplibre', 'three'],
    swatchColor: HIGHLAND_THEME.text.primary,
    zoomLod: true,
  },
  {
    id: 'entities.trajectory',
    category: 'entities',
    label: 'Flight Path & Waypoints',
    defaultVisible: true,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar', 'maplibre', 'three'],
    swatchColor: HIGHLAND_THEME.cartography.routeCore,
  },
  {
    id: 'entities.obstacles',
    category: 'entities',
    label: 'Spatial Obstacles',
    defaultVisible: true,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar', 'maplibre'],
    scopeTag: '2D / Geo',
    swatchColor: HIGHLAND_THEME.signal.vermilion,
  },
  // Category C — Communication
  {
    id: 'comm.links',
    category: 'comm',
    label: 'Air-to-Ground Links',
    defaultVisible: true,
    supportsOpacity: true,
    defaultOpacity: 0.85,
    targets: ['radar', 'maplibre', 'three'],
    scopeTag: '2D / Geo',
    swatchColor: HIGHLAND_THEME.signal.sage,
  },
  {
    id: 'comm.transmissions',
    category: 'comm',
    label: 'Active Transmissions & Packets',
    defaultVisible: true,
    supportsOpacity: true,
    defaultOpacity: 0.90,
    targets: ['radar', 'three'],
    scopeTag: '2D / 3D',
    swatchColor: HIGHLAND_THEME.signal.amberBright,
  },
  {
    id: 'comm.coverage',
    category: 'comm',
    label: 'ACN Coverage Footprint',
    defaultVisible: false,
    supportsOpacity: true,
    defaultOpacity: 0.35,
    targets: ['radar', 'maplibre'],
    scopeTag: '2D / Geo',
    swatchColor: HIGHLAND_THEME.signal.amber,
  },
  // Category D — RF & Propagation Analysis
  {
    id: 'rf.losAnalysis',
    category: 'rf',
    label: 'Selected-Link LOS & Margin',
    defaultVisible: false,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar', 'maplibre'],
    scopeTag: '2D / Geo',
    swatchColor: HIGHLAND_THEME.signal.sage,
  },
  {
    id: 'rf.fresnelZone',
    category: 'rf',
    label: 'First Fresnel Corridor (0.6 F₁)',
    defaultVisible: false,
    supportsOpacity: true,
    defaultOpacity: 0.45,
    targets: ['radar', 'maplibre'],
    scopeTag: '2D / Geo',
    swatchColor: HIGHLAND_THEME.cartography.terrainStrokeLos,
  },
  {
    id: 'rf.obstructionPoints',
    category: 'rf',
    label: 'Terrain Crest & Obstacle Hits',
    defaultVisible: false,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar', 'maplibre'],
    scopeTag: '2D / Geo',
    swatchColor: HIGHLAND_THEME.signal.vermilion,
  },
  {
    id: 'rf.signalQuality',
    category: 'rf',
    label: 'Terminal SNR & Lookahead Rings',
    defaultVisible: false,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar'],
    scopeTag: '2D',
    swatchColor: HIGHLAND_THEME.signal.ochre,
  },
  // Category E — Engineering Overlays
  {
    id: 'eng.measurements',
    category: 'eng',
    label: 'Distance Ruler & Drawn Regions',
    defaultVisible: true,
    supportsOpacity: false,
    defaultOpacity: 1.0,
    targets: ['radar', 'maplibre'],
    scopeTag: '2D / Geo',
    swatchColor: HIGHLAND_THEME.text.primary,
  },
];

const LAYER_DEF_BY_ID: Record<MapLayerId, MapLayerDefinition> = MAP_LAYER_DEFINITIONS.reduce(
  (acc, def) => {
    acc[def.id] = def;
    return acc;
  },
  {} as Record<MapLayerId, MapLayerDefinition>
);

const CATEGORY_LAYERS: Record<MapLayerCategoryId, readonly MapLayerId[]> = {
  base: MAP_LAYER_DEFINITIONS.filter((d) => d.category === 'base').map((d) => d.id),
  entities: MAP_LAYER_DEFINITIONS.filter((d) => d.category === 'entities').map((d) => d.id),
  comm: MAP_LAYER_DEFINITIONS.filter((d) => d.category === 'comm').map((d) => d.id),
  rf: MAP_LAYER_DEFINITIONS.filter((d) => d.category === 'rf').map((d) => d.id),
  eng: MAP_LAYER_DEFINITIONS.filter((d) => d.category === 'eng').map((d) => d.id),
};

export const MAP_LAYER_PRESETS: Record<MapLayerPresetId, {
  readonly id: MapLayerPresetId;
  readonly label: string;
  readonly visibility: Record<MapLayerId, boolean>;
}> = {
  operational: {
    id: 'operational',
    label: 'Operational',
    visibility: {
      'base.terrainDem': true,
      'base.contours': false,
      'base.demBoundary': false,
      'base.rangeGrid': false,
      'entities.acn': true,
      'entities.groundNodes': true,
      'entities.labels': true,
      'entities.trajectory': true,
      'entities.obstacles': true,
      'comm.links': true,
      'comm.transmissions': true,
      'comm.coverage': false,
      'rf.losAnalysis': false,
      'rf.fresnelZone': false,
      'rf.obstructionPoints': false,
      'rf.signalQuality': false,
      'eng.measurements': true,
    },
  },
  rf_analysis: {
    id: 'rf_analysis',
    label: 'RF Analysis',
    visibility: {
      'base.terrainDem': true,
      'base.contours': false,
      'base.demBoundary': false,
      'base.rangeGrid': false,
      'entities.acn': true,
      'entities.groundNodes': true,
      'entities.labels': true,
      'entities.trajectory': true,
      'entities.obstacles': true,
      'comm.links': true,
      'comm.transmissions': true,
      'comm.coverage': false,
      'rf.losAnalysis': true,
      'rf.fresnelZone': true,
      'rf.obstructionPoints': true,
      'rf.signalQuality': false,
      'eng.measurements': true,
    },
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    visibility: {
      'base.terrainDem': true,
      'base.contours': false,
      'base.demBoundary': false,
      'base.rangeGrid': false,
      'entities.acn': true,
      'entities.groundNodes': true,
      'entities.labels': false,
      'entities.trajectory': false,
      'entities.obstacles': false,
      'comm.links': true,
      'comm.transmissions': false,
      'comm.coverage': false,
      'rf.losAnalysis': false,
      'rf.fresnelZone': false,
      'rf.obstructionPoints': false,
      'rf.signalQuality': false,
      'eng.measurements': false,
    },
  },
  all: {
    id: 'all',
    label: 'All',
    visibility: {
      'base.terrainDem': true,
      'base.contours': true,
      'base.demBoundary': true,
      'base.rangeGrid': true,
      'entities.acn': true,
      'entities.groundNodes': true,
      'entities.labels': true,
      'entities.trajectory': true,
      'entities.obstacles': true,
      'comm.links': true,
      'comm.transmissions': true,
      'comm.coverage': true,
      'rf.losAnalysis': true,
      'rf.fresnelZone': true,
      'rf.obstructionPoints': true,
      'rf.signalQuality': true,
      'eng.measurements': true,
    },
  },
};

export const MIN_LAYER_OPACITY = 0.15;
export const MAX_LAYER_OPACITY = 1.0;

interface SerializedMapLayerConfig {
  version: 1;
  layers: Record<string, { visible?: unknown; opacity?: unknown }>;
  contextualFocusEnabled?: unknown;
  collapsedCategories?: Record<string, unknown>;
}

function defaultBrowserStorage(): StorageLike | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage access may be restricted in sandboxed/private contexts
  }
  return null;
}

export function clampLayerOpacity(id: MapLayerId, rawOpacity: number): number {
  const def = LAYER_DEF_BY_ID[id];
  if (!def || !def.supportsOpacity) return 1.0;
  if (!Number.isFinite(rawOpacity)) return def.defaultOpacity;
  return Math.max(MIN_LAYER_OPACITY, Math.min(MAX_LAYER_OPACITY, rawOpacity));
}

export function getMapZoomLodTier(radarRangeM: number): MapZoomLodTier {
  if (!Number.isFinite(radarRangeM) || radarRangeM > 90000) return 'distant';
  if (radarRangeM >= 35000) return 'medium';
  return 'close';
}

export type MapLayerChangeListener = () => void;

export class MapLayerRegistry {
  private readonly storage: StorageLike | null;
  private readonly states: Record<MapLayerId, MapLayerStateEntry>;
  private readonly collapsedCategories: Record<MapLayerCategoryId, boolean>;
  private contextualFocusEnabled = true;
  private readonly listeners = new Set<MapLayerChangeListener>();

  constructor(storage: StorageLike | null = defaultBrowserStorage()) {
    this.storage = storage;
    this.states = {} as Record<MapLayerId, MapLayerStateEntry>;
    this.collapsedCategories = {
      base: false,
      entities: false,
      comm: false,
      rf: false,
      eng: false,
    };
    this.initDefaults();
    this.loadFromStorage();
  }

  private initDefaults(): void {
    for (const def of MAP_LAYER_DEFINITIONS) {
      this.states[def.id] = {
        visible: def.defaultVisible,
        opacity: def.defaultOpacity,
      };
    }
    this.contextualFocusEnabled = true;
    this.collapsedCategories.base = false;
    this.collapsedCategories.entities = false;
    this.collapsedCategories.comm = false;
    this.collapsedCategories.rf = false;
    this.collapsedCategories.eng = false;
  }

  private loadFromStorage(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(MAP_LAYER_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Partial<SerializedMapLayerConfig> | null;
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return;

      if (typeof parsed.contextualFocusEnabled === 'boolean') {
        this.contextualFocusEnabled = parsed.contextualFocusEnabled;
      }
      if (parsed.collapsedCategories && typeof parsed.collapsedCategories === 'object') {
        for (const cat of MAP_LAYER_CATEGORIES) {
          const val = parsed.collapsedCategories[cat.id];
          if (typeof val === 'boolean') {
            this.collapsedCategories[cat.id] = val;
          }
        }
      }
      if (parsed.layers && typeof parsed.layers === 'object') {
        for (const def of MAP_LAYER_DEFINITIONS) {
          const saved = parsed.layers[def.id];
          if (!saved || typeof saved !== 'object') continue;
          if (typeof saved.visible === 'boolean') {
            this.states[def.id].visible = saved.visible;
          }
          if (def.supportsOpacity && typeof saved.opacity === 'number' && Number.isFinite(saved.opacity)) {
            this.states[def.id].opacity = clampLayerOpacity(def.id, saved.opacity);
          }
        }
      }
    } catch {
      // Ignore corrupt persisted state and retain schema defaults
    }
  }

  private saveToStorage(): void {
    if (!this.storage) return;
    const layers: Record<string, { visible: boolean; opacity: number }> = {};
    for (const def of MAP_LAYER_DEFINITIONS) {
      const entry = this.states[def.id];
      layers[def.id] = {
        visible: entry.visible,
        opacity: entry.opacity,
      };
    }
    const payload: SerializedMapLayerConfig = {
      version: 1,
      layers,
      contextualFocusEnabled: this.contextualFocusEnabled,
      collapsedCategories: { ...this.collapsedCategories },
    };
    try {
      this.storage.setItem(MAP_LAYER_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore quota / security errors gracefully
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribe(listener: MapLayerChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getDefinition(id: MapLayerId): MapLayerDefinition {
    return LAYER_DEF_BY_ID[id];
  }

  isLayerVisible(id: MapLayerId): boolean {
    return this.states[id].visible;
  }

  getLayerOpacity(id: MapLayerId): number {
    return this.states[id].opacity;
  }

  isContextualFocusEnabled(): boolean {
    return this.contextualFocusEnabled;
  }

  isCategoryCollapsed(categoryId: MapLayerCategoryId): boolean {
    return this.collapsedCategories[categoryId];
  }

  setCategoryCollapsed(categoryId: MapLayerCategoryId, collapsed: boolean): void {
    if (this.collapsedCategories[categoryId] === collapsed) return;
    this.collapsedCategories[categoryId] = collapsed;
    this.saveToStorage();
    this.notify();
  }

  setContextualFocusEnabled(enabled: boolean): void {
    if (this.contextualFocusEnabled === enabled) return;
    this.contextualFocusEnabled = enabled;
    this.saveToStorage();
    this.notify();
  }

  setLayerVisible(id: MapLayerId, visible: boolean): void {
    const entry = this.states[id];
    if (!entry || entry.visible === visible) return;
    entry.visible = visible;
    this.saveToStorage();
    this.notify();
  }

  toggleLayer(id: MapLayerId): boolean {
    const next = !this.states[id].visible;
    this.setLayerVisible(id, next);
    return next;
  }

  setLayerOpacity(id: MapLayerId, opacity: number): void {
    const def = LAYER_DEF_BY_ID[id];
    if (!def || !def.supportsOpacity || !Number.isFinite(opacity)) return;
    const clamped = clampLayerOpacity(id, opacity);
    if (Math.abs(this.states[id].opacity - clamped) < 1e-6) return;
    this.states[id].opacity = clamped;
    this.saveToStorage();
    this.notify();
  }

  getCategoryState(categoryId: MapLayerCategoryId): CategoryToggleState {
    const ids = CATEGORY_LAYERS[categoryId];
    let enabledCount = 0;
    for (let i = 0; i < ids.length; i++) {
      if (this.states[ids[i]].visible) enabledCount++;
    }
    const totalCount = ids.length;
    return {
      checked: enabledCount === totalCount && totalCount > 0,
      indeterminate: enabledCount > 0 && enabledCount < totalCount,
      enabledCount,
      totalCount,
    };
  }

  setCategoryVisible(categoryId: MapLayerCategoryId, visible: boolean): void {
    const ids = CATEGORY_LAYERS[categoryId];
    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      if (this.states[ids[i]].visible !== visible) {
        this.states[ids[i]].visible = visible;
        changed = true;
      }
    }
    if (!changed) return;
    this.saveToStorage();
    this.notify();
  }

  applyPreset(presetId: MapLayerPresetId): void {
    const preset = MAP_LAYER_PRESETS[presetId];
    if (!preset) return;
    let changed = false;
    for (const def of MAP_LAYER_DEFINITIONS) {
      const next = preset.visibility[def.id];
      if (this.states[def.id].visible !== next) {
        this.states[def.id].visible = next;
        changed = true;
      }
    }
    if (!changed) return;
    this.saveToStorage();
    this.notify();
  }

  getActivePresetId(): MapLayerPresetId | 'custom' {
    const presetOrder: readonly MapLayerPresetId[] = ['operational', 'rf_analysis', 'minimal', 'all'];
    for (const presetId of presetOrder) {
      const vis = MAP_LAYER_PRESETS[presetId].visibility;
      let matches = true;
      for (let i = 0; i < MAP_LAYER_DEFINITIONS.length; i++) {
        const id = MAP_LAYER_DEFINITIONS[i].id;
        if (this.states[id].visible !== vis[id]) {
          matches = false;
          break;
        }
      }
      if (matches) return presetId;
    }
    return 'custom';
  }

  getEnabledCount(): number {
    let count = 0;
    for (let i = 0; i < MAP_LAYER_DEFINITIONS.length; i++) {
      if (this.states[MAP_LAYER_DEFINITIONS[i].id].visible) count++;
    }
    return count;
  }

  getTotalCount(): number {
    return MAP_LAYER_DEFINITIONS.length;
  }

  resetDefaults(): void {
    this.initDefaults();
    this.saveToStorage();
    this.notify();
  }

  /**
   * Evaluates read-time layer visibility, temporarily revealing edited entity layers
   * during trajectory or obstacle editing without mutating persisted user state.
   */
  getEffectiveVisibility(id: MapLayerId, ctx?: ContextualMapContext): boolean {
    if (ctx) {
      if (ctx.isTrajectoryEditing && id === 'entities.trajectory') return true;
      if (ctx.isObstacleEditing && id === 'entities.obstacles') return true;
    }
    return this.states[id].visible;
  }

  /**
   * Evaluates read-time alpha combining user opacity preference, active edit-mode
   * subduing (`0.22`), and node-selection focus dimming (`0.16` links, `0.55` markers)
   * without mutating persisted preferences.
   */
  getEffectiveAlpha(
    id: MapLayerId,
    ctx?: ContextualMapContext,
    target?: number | null | { nodeId?: number | null; isSelected?: boolean }
  ): number {
    if (!this.getEffectiveVisibility(id, ctx)) return 0;

    const def = LAYER_DEF_BY_ID[id];
    let alpha = def.supportsOpacity ? this.states[id].opacity : 1.0;

    if (!ctx) return alpha;

    if ((ctx.isTrajectoryEditing || ctx.isObstacleEditing) && (id === 'comm.links' || id === 'comm.transmissions')) {
      alpha *= 0.22;
    }

    const focusEnabled = ctx.contextualFocusEnabled ?? this.contextualFocusEnabled;
    const selectedNodeId = ctx.selectedNodeId;
    if (focusEnabled && selectedNodeId !== null && selectedNodeId !== undefined && Number.isFinite(selectedNodeId)) {
      let hasTarget = false;
      let isSelectedTarget = false;
      if (typeof target === 'number') {
        hasTarget = true;
        isSelectedTarget = target === selectedNodeId;
      } else if (target && typeof target === 'object') {
        if (typeof target.isSelected === 'boolean') {
          hasTarget = true;
          isSelectedTarget = target.isSelected;
        } else if (target.nodeId !== null && target.nodeId !== undefined) {
          hasTarget = true;
          isSelectedTarget = target.nodeId === selectedNodeId;
        }
      }

      if (hasTarget) {
        if (!isSelectedTarget) {
          if (id === 'comm.links' || id === 'comm.transmissions') {
            alpha *= 0.16;
          } else if (id === 'entities.groundNodes' || id === 'entities.labels') {
            alpha *= 0.55;
          }
        } else if (id === 'comm.links' && !ctx.isTrajectoryEditing && !ctx.isObstacleEditing) {
          alpha = Math.max(alpha, 0.95);
        }
      }
    }

    return alpha;
  }
}
