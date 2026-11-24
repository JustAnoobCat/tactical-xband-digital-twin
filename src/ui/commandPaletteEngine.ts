/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Frontier Command Palette Engine (SPEC-V3-08)
 *
 * Implements pure, deterministic, zero-allocation-per-frame command catalog,
 * deterministic prefix/fuzzy ranking, and keyboard navigation reducer.
 *
 * 100% headless testable, free of WebGL/DOM dependencies and Math.random().
 */

export type PaletteCommandCategory = 'NAV' | 'BIOME' | 'PHYSICS' | 'TOOLS' | 'SIM' | 'EXPORT';

export interface PaletteCommand {
  readonly id: string;
  readonly category: PaletteCommandCategory;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly shortcut?: string;
}

export interface RankedPaletteCommand {
  readonly command: PaletteCommand;
  readonly score: number;
}

export type PaletteNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/**
 * Authoritative default tactical command catalog (37 distinct commands).
 */
export const DEFAULT_PALETTE_COMMANDS: readonly PaletteCommand[] = Object.freeze([
  // --- Workspace Navigation (NAV) ---
  {
    id: 'nav:overview',
    category: 'NAV',
    label: 'Switch to OPS (Mission Overview)',
    keywords: ['ops', 'overview', 'map', 'mission', 'workspace', 'tactical'],
    shortcut: '1',
  },
  {
    id: 'nav:scheduler',
    category: 'NAV',
    label: 'Switch to TDMA (Adaptive Scheduler)',
    keywords: ['tdma', 'scheduler', 'slot', 'frames', 'slots', 'superframe'],
    shortcut: '2',
  },
  {
    id: 'nav:network',
    category: 'NAV',
    label: 'Switch to NET (Network Performance & QoS)',
    keywords: ['net', 'network', 'throughput', 'queues', 'qos', '5qi', 'sla'],
    shortcut: '3',
  },
  {
    id: 'nav:terrain',
    category: 'NAV',
    label: 'Switch to RF (Terrain & Electromagnetic Propagation)',
    keywords: ['rf', 'terrain', 'elevation', 'dem', 'los', 'knife-edge', 'fresnel'],
    shortcut: '4',
  },
  {
    id: 'nav:terminal',
    category: 'NAV',
    label: 'Switch to NODES (Terminals & Antenna Arrays)',
    keywords: ['nodes', 'terminals', 'vsa', 'constellation', 'fleet', 'phased-array'],
    shortcut: '5',
  },
  {
    id: 'nav:authoring',
    category: 'NAV',
    label: 'Switch to PLAN (Scenario Authoring)',
    keywords: ['plan', 'authoring', 'waypoints', 'scenarios', 'mission', 'flight-plan'],
    shortcut: '6',
  },
  {
    id: 'nav:doc',
    category: 'NAV',
    label: 'Switch to LAB (Technical Reference & AAR Exporter)',
    keywords: ['lab', 'doc', 'reference', 'diagnostics', 'dossier', 'aar', 'export'],
    shortcut: '7',
  },
  {
    id: 'nav:registration',
    category: 'NAV',
    label: 'Switch to REG (Registration & Zero-Trust Security)',
    keywords: ['registration', 'reg', 'security', 'zero-trust', 'mtls', 'cryptography'],
    shortcut: '8',
  },
  {
    id: 'nav:soldier',
    category: 'NAV',
    label: 'Switch to PHONE (Soldier Handheld ATAK View)',
    keywords: ['phone', 'soldier', 'handheld', 'atak', 'tactical phone', 'c2 phone'],
    shortcut: '9',
  },
  {
    id: 'nav:analytics',
    category: 'NAV',
    label: 'Switch to ANALYTICS (Comparative Ablation KPIs)',
    keywords: ['analytics', 'comparative', 'ablation', 'kpi', 'gain', 'waste', 'drops'],
  },
  {
    id: 'nav:calibration',
    category: 'NAV',
    label: 'Switch to CAL (Digital Twin Calibration)',
    keywords: ['cal', 'calibration', 'replay', 'flight-test', 'residuals', 'rmse'],
  },

  // --- Biome & Geomorphology Selection (BIOME) ---
  {
    id: 'biome:ladakh',
    category: 'BIOME',
    label: 'Select Ladakh Alpine Mountain Biome (34.5°N, 76.5°E)',
    keywords: ['ladakh', 'alpine', 'mountain', 'himalayas', 'high-relief', 'srtm'],
  },
  {
    id: 'biome:kargil',
    category: 'BIOME',
    label: 'Select Kargil Valley Corridor Biome',
    keywords: ['kargil', 'valley', 'corridor', 'transit', 'canyon', 'defile'],
  },
  {
    id: 'biome:arid_desert',
    category: 'BIOME',
    label: 'Select Thar Arid Desert Biome (27.0°N, 71.5°E)',
    keywords: ['desert', 'thar', 'arid', 'sand', 'heat', 'dunes'],
  },
  {
    id: 'biome:open_plains',
    category: 'BIOME',
    label: 'Select Indo-Gangetic Open Plains Biome (28.5°N, 77.2°E)',
    keywords: ['plains', 'indo-gangetic', 'flat', 'open', 'agriculture'],
  },
  {
    id: 'biome:tropical_jungle',
    category: 'BIOME',
    label: 'Select Northeast Tropical Jungle Biome (26.0°N, 93.0°E)',
    keywords: ['jungle', 'tropical', 'northeast', 'foliage', 'canopy', 'rain'],
  },
  {
    id: 'biome:maritime_littoral',
    category: 'BIOME',
    label: 'Select Arabian Sea Maritime Littoral Biome (18.5°N, 72.0°E)',
    keywords: ['maritime', 'sea', 'littoral', 'arabian', 'duct', 'evaporation', 'ocean'],
  },

  // --- Cartographic & 3D Volumetric Tools (TOOLS) ---
  {
    id: 'tools:2d3d',
    category: 'TOOLS',
    label: 'Toggle 2D Tactical Map / 3D Volumetric Terrain View',
    keywords: ['3d', '2d', 'three', 'globe', 'volumetric', 'perspective', 'view'],
    shortcut: 'T',
  },
  {
    id: 'tools:cvd',
    category: 'TOOLS',
    label: 'Toggle Colorblind-Safe (CVD) Palette Mode',
    keywords: ['cvd', 'colorblind', 'palette', 'accessibility', 'contrast', 'protanopia', 'deuteranopia'],
  },
  {
    id: 'tools:fresnel',
    category: 'TOOLS',
    label: 'Toggle 3D Fresnel 0.6 F1 Ellipsoid Volumes',
    keywords: ['fresnel', 'ellipsoid', 'clearance', '3d rf', 'zone', 'knife-edge'],
  },
  {
    id: 'tools:lobes',
    category: 'TOOLS',
    label: 'Toggle 3D Banking Quad-Sector Antenna Lobes',
    keywords: ['lobes', 'antenna', 'sector', 'quad', 'banking', 'roll', 'boresight'],
  },
  {
    id: 'tools:volumes',
    category: 'TOOLS',
    label: 'Toggle 3D EW Threat Dome & Storm Volumes',
    keywords: ['volumes', 'ew', 'threat', 'storm', 'weather', 'jammer dome', 'cylinder'],
  },
  {
    id: 'tools:mgrs',
    category: 'TOOLS',
    label: 'Toggle Tactical MGRS Cartographic Grid Overlay',
    keywords: ['mgrs', 'grid', 'utm', 'coordinates', 'overlay', 'military', 'cartography'],
  },
  {
    id: 'tools:ruler',
    category: 'TOOLS',
    label: 'Activate Tactical Distance Ruler Tool',
    keywords: ['ruler', 'distance', 'measure', 'range', 'bearing', 'slant-range'],
    shortcut: 'R',
  },
  {
    id: 'tools:probe',
    category: 'TOOLS',
    label: 'Activate Precision Cursor Elevation & LOS Probe',
    keywords: ['probe', 'cursor', 'elevation', 'los', 'inspect', 'terrain'],
    shortcut: 'P',
  },
  {
    id: 'tools:area',
    category: 'TOOLS',
    label: 'Activate Area Coverage Swath Tool',
    keywords: ['area', 'swath', 'polygon', 'coverage', 'box', 'reconnaissance'],
    shortcut: 'A',
  },
  {
    id: 'tools:barrier',
    category: 'TOOLS',
    label: 'Activate CAD Obstacle Barrier Tool',
    keywords: ['barrier', 'obstacle', 'cad', 'knife-edge', 'wall', 'diffraction'],
    shortcut: 'B',
  },
  {
    id: 'tools:pan',
    category: 'TOOLS',
    label: 'Activate Pan / Navigate Tool',
    keywords: ['pan', 'navigate', 'hand', 'select', 'default'],
    shortcut: 'N',
  },

  // --- Physics & EW Toggles (PHYSICS) ---
  {
    id: 'physics:high_fidelity',
    category: 'PHYSICS',
    label: 'Toggle High-Fidelity Physics Stack (Shadowing, Fading, Feedback, ABR)',
    keywords: ['physics', 'high-fidelity', 'all models', 'shadowing', 'rician', 'abr', 'feedback'],
  },
  {
    id: 'physics:biome_em',
    category: 'PHYSICS',
    label: 'Toggle Biome EM Ground Reflection Model',
    keywords: ['biome em', 'reflection', 'dielectric', 'conductivity', 'ground', 'two-ray'],
  },

  // --- Simulation Transport & Mission Execution (SIM) ---
  {
    id: 'sim:pause_resume',
    category: 'SIM',
    label: 'Pause / Resume Live Simulation',
    keywords: ['pause', 'resume', 'play', 'run', 'space', 'freeze'],
    shortcut: 'Space',
  },
  {
    id: 'sim:step',
    category: 'SIM',
    label: 'Step Simulation One 20 ms Discrete Frame',
    keywords: ['step', 'advance', 'frame', 'tick', 'discrete'],
    shortcut: '.',
  },
  {
    id: 'sim:reset',
    category: 'SIM',
    label: 'Reset Simulation Theater to Initial State',
    keywords: ['reset', 'restart', 'reinit', 'reload', 'revert'],
  },
  {
    id: 'sim:kargil_transit',
    category: 'SIM',
    label: 'Execute Kargil Transit Mission Profile',
    keywords: ['kargil transit', 'transit', 'flight', 'mission profile', 'scenario'],
  },
  {
    id: 'sim:calibrate',
    category: 'SIM',
    label: 'Auto-Calibrate Digital Twin Residuals Against Flight Trace',
    keywords: ['calibrate', 'twin', 'rmse', 'optimization', 'residuals', 'flight-test'],
  },

  // --- Export & Reporting (EXPORT) ---
  {
    id: 'export:scenario_json',
    category: 'EXPORT',
    label: 'Save Scenario Configuration JSON (v3 Schema)',
    keywords: ['scenario', 'json', 'export', 'save', 'mission file'],
  },
  {
    id: 'export:kml',
    category: 'EXPORT',
    label: 'Export Tactical Mission to OGC KML 2.2',
    keywords: ['kml', 'gis', 'google earth', 'export', 'cartography'],
  },
  {
    id: 'export:cot_xml',
    category: 'EXPORT',
    label: 'Export Tactical Cursor-on-Target (CoT) XML',
    keywords: ['cot', 'atak', 'cursor-on-target', 'xml', 'tactical', 'dod'],
  },
  {
    id: 'export:aar_md',
    category: 'EXPORT',
    label: 'Export After-Action Review (AAR) Briefing Markdown',
    keywords: ['aar', 'after-action', 'review', 'briefing', 'markdown', 'report', 'export'],
  },
  {
    id: 'export:aar_html',
    category: 'EXPORT',
    label: 'Print After-Action Review (AAR) Standalone HTML Briefing',
    keywords: ['print aar', 'html', 'briefing', 'paper', 'pdf', 'standalone', 'export'],
  },
]);

interface NormalizedCommandInfo {
  readonly labelLower: string;
  readonly idLower: string;
  readonly catLower: string;
  readonly shortcutLower: string;
  readonly keywordsLower: readonly string[];
}

const NORM_CACHE = new WeakMap<PaletteCommand, NormalizedCommandInfo>();

function getNormalizedCommandInfo(cmd: PaletteCommand): NormalizedCommandInfo {
  let info = NORM_CACHE.get(cmd);
  if (!info) {
    info = {
      labelLower: cmd.label.toLowerCase(),
      idLower: cmd.id.toLowerCase(),
      catLower: cmd.category.toLowerCase(),
      shortcutLower: cmd.shortcut ? cmd.shortcut.toLowerCase() : '',
      keywordsLower: cmd.keywords.map((k) => k.toLowerCase()),
    };
    NORM_CACHE.set(cmd, info);
  }
  return info;
}

/**
 * Computes deterministic matching score between query and a command.
 * Returns score > 0 for a match, or 0 if no match.
 */
export function scoreCommandMatch(query: string, cmd: PaletteCommand): number {
  if (typeof query !== 'string') return 0;
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 1; // Match all for empty query

  const norm = getNormalizedCommandInfo(cmd);
  const labelLower = norm.labelLower;
  const idLower = norm.idLower;
  const catLower = norm.catLower;
  const shortcutLower = norm.shortcutLower;

  // 1. Exact shortcut match
  if (shortcutLower && shortcutLower === q) {
    return 120;
  }

  // 2. Exact label prefix match
  if (labelLower.startsWith(q)) {
    return 100 + Math.max(0, 10 - (labelLower.length - q.length));
  }

  // 3. Word-boundary match in label (fast zero-allocation check)
  // e.g. "ruler" matches "... Distance Ruler Tool"
  if (hasWordBoundaryMatch(labelLower, q)) {
    const idx = labelLower.indexOf(q);
    return 70 + Math.max(0, 10 - Math.min(10, Math.floor(idx / 5)));
  }

  // 4. Exact keyword match or keyword prefix
  for (let i = 0; i < norm.keywordsLower.length; i++) {
    const kw = norm.keywordsLower[i];
    if (kw === q) {
      return 65;
    }
    if (kw.startsWith(q)) {
      return 60;
    }
  }

  // 5. Label substring match
  if (labelLower.includes(q)) {
    return 50;
  }

  // 6. Category prefix or ID match
  if (catLower.startsWith(q) || idLower.includes(q)) {
    return 40;
  }

  // 7. Keyword substring match
  for (let i = 0; i < norm.keywordsLower.length; i++) {
    const kw = norm.keywordsLower[i];
    if (kw.includes(q)) {
      return 35;
    }
  }

  // 8. Ordered character subsequence match on label
  let qIdx = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  for (let i = 0; i < labelLower.length && qIdx < q.length; i++) {
    if (labelLower[i] === q[qIdx]) {
      if (qIdx === 0) firstMatch = i;
      lastMatch = i;
      qIdx++;
    }
  }
  if (qIdx === q.length && q.length >= 2) {
    const span = lastMatch - firstMatch + 1;
    const compactnessBonus = Math.max(0, 10 - (span - q.length));
    return 15 + compactnessBonus;
  }

  return 0;
}

function hasWordBoundaryMatch(text: string, q: string): boolean {
  let pos = 0;
  while ((pos = text.indexOf(q, pos)) !== -1) {
    if (pos === 0) return true;
    const prev = text.charCodeAt(pos - 1);
    // Space (32), '-' (45), '_' (95), '/' (47), ':' (58), '(' (40), '.' (46)
    if (prev === 32 || prev === 45 || prev === 95 || prev === 47 || prev === 58 || prev === 40 || prev === 46) {
      return true;
    }
    pos += 1;
  }
  return false;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filters and ranks commands according to query.
 * Deterministic sorting: highest score first; ties broken by original catalog order.
 */
export function filterAndRankCommands(
  query: string,
  commands: readonly PaletteCommand[] = DEFAULT_PALETTE_COMMANDS
): RankedPaletteCommand[] {
  if (!Array.isArray(commands)) return [];
  const q = typeof query === 'string' ? query.trim() : '';

  if (q.length === 0) {
    return commands.map((command) => ({ command, score: 1 }));
  }

  interface IndexedRankedCommand {
    readonly command: PaletteCommand;
    readonly score: number;
    readonly origIndex: number;
  }

  const results: IndexedRankedCommand[] = [];
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const score = scoreCommandMatch(q, cmd);
    if (score > 0) {
      results.push({ command: cmd, score, origIndex: i });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.origIndex - b.origIndex;
  });

  return results;
}

/**
 * Pure keyboard navigation state reducer for Command Palette selection.
 * Handles ArrowDown, ArrowUp, Home, End with circular wrapping.
 */
export function stepPaletteSelection(
  currentIndex: number,
  totalItems: number,
  key: PaletteNavigationKey
): number {
  if (!Number.isFinite(totalItems) || totalItems <= 0) {
    return -1;
  }

  const count = Math.floor(totalItems);

  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowDown':
      if (currentIndex < 0 || currentIndex >= count) {
        return 0;
      }
      return (currentIndex + 1) % count;
    case 'ArrowUp':
      if (currentIndex <= 0 || currentIndex >= count) {
        return count - 1;
      }
      return currentIndex - 1;
    default:
      return currentIndex;
  }
}
