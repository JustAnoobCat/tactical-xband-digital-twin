/**
 * Highland Instrument — Authoritative Canvas 2D & Visualization Theme Tokens
 *
 * Swiss-cartographic basalt-slate neutral substrates paired with strict semantic
 * signal encoding (Alpine Sage, Titanium-Amber, Signal Ochre, Alert Vermilion,
 * Burnt Copper, Quartz Indigo, Neutral Ash) and redundant line dash styles.
 */

export const HIGHLAND_THEME = Object.freeze({
  substrate: Object.freeze({
    void: '#111316',
    bg: '#171a1f',
    surface: '#1e2229',
    raised: '#252a33',
    elevated: '#2e3440',
    hudFill: 'rgba(17, 19, 22, 0.90)',
    hudFillSoft: 'rgba(23, 26, 31, 0.78)',
  }),

  line: Object.freeze({
    subtle: 'rgba(240, 236, 228, 0.10)',
    strong: 'rgba(240, 236, 228, 0.22)',
    grid: 'rgba(240, 236, 228, 0.08)',
    gridMajor: 'rgba(240, 236, 228, 0.16)',
    frame: '#2e3440',
    rulerTick: '#3a414f',
  }),

  text: Object.freeze({
    primary: '#f2efe9',
    muted: '#b3afa7',
    faint: '#87847c',
    darkOnSignal: '#111316',
  }),

  signal: Object.freeze({
    // Connected / Clear LoS / Delivered Goodput
    sage: '#52b788',
    sageBright: '#74c69d',
    sageSoft: 'rgba(82, 183, 136, 0.20)',
    sageStrokeSoft: 'rgba(82, 183, 136, 0.45)',

    // Airborne Relay / Active Focus / Selection / Pre-Occlusion Flush
    amber: '#e09f3e',
    amberBright: '#f0b85c',
    amberDeep: '#b87e28',
    amberSoft: 'rgba(224, 159, 62, 0.16)',
    amberStrokeSoft: 'rgba(224, 159, 62, 0.45)',

    // Degraded / Pre-Occlusion Warning / Fresnel Grazing
    ochre: '#e9c46a',
    ochreSoft: 'rgba(233, 196, 106, 0.16)',
    ochreStrokeSoft: 'rgba(233, 196, 106, 0.65)',

    // Blocked (Terrain) / Outage Waste / Critical Drop
    vermilion: '#e05347',
    vermilionBright: '#f07167',
    vermilionSoft: 'rgba(224, 83, 71, 0.22)',
    vermilionStrokeSoft: 'rgba(224, 83, 71, 0.65)',

    // Blocked (Obstacle)
    copper: '#d97736',
    copperBright: '#eb9357',
    copperSoft: 'rgba(217, 119, 54, 0.22)',
    copperStrokeSoft: 'rgba(217, 119, 54, 0.70)',

    // Control Subframe / Queue Drop / Secondary Channel
    indigo: '#8a95e6',
    indigoSoft: 'rgba(138, 149, 230, 0.18)',

    // Outage / Offline / Unverified
    ash: '#747c88',
    ashSoft: 'rgba(116, 124, 136, 0.20)',
    ashStrokeSoft: 'rgba(116, 124, 136, 0.45)',
    slate: '#58606d',
    slateStrokeSoft: 'rgba(88, 96, 109, 0.35)',
  }),

  cartography: Object.freeze({
    routeKeyline: 'rgba(17, 19, 22, 0.92)',
    routeCore: '#c9bfa9',
    routeChevron: '#f2efe9',
    routeDraft: '#e9c46a',
    contour: 'rgba(179, 175, 167, 0.30)',
    summitMarker: '#e9c46a',
    summitLabel: 'rgba(242, 239, 233, 0.86)',
    rangeRing: 'rgba(240, 236, 228, 0.18)',
    rangeLabel: 'rgba(179, 175, 167, 0.80)',
    crosshair: 'rgba(240, 236, 228, 0.10)',
    reticle: 'rgba(224, 159, 62, 0.45)',
    demBoundary: 'rgba(224, 159, 62, 0.62)',
    demBracket: 'rgba(224, 159, 62, 0.90)',
    terrainStrokeLos: '#7fa1b8',
    terrainTopGrad: '#3a4048',
    terrainBottomGrad: '#14171c',
    terrainBareDem: 'rgba(179, 175, 167, 0.38)',
  }),

  chartSeries: Object.freeze([
    '#52b788',
    '#e09f3e',
    '#8a95e6',
    '#e9c46a',
    '#d97736',
    '#7fb3d5',
  ] as const),

  font: Object.freeze({
    sans: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, Consolas, Menlo, monospace',
  }),

  dash: Object.freeze({
    solid: Object.freeze([] as readonly number[]),
    degraded: Object.freeze([7, 3] as readonly number[]),
    blockedTerrain: Object.freeze([4, 4] as readonly number[]),
    blockedObstacle: Object.freeze([2, 4] as readonly number[]),
    outage: Object.freeze([3, 6] as readonly number[]),
    unknown: Object.freeze([1, 5] as readonly number[]),
  }),

  thresholds: Object.freeze({
    outageSnrDb: -1.5,
    qpskHalfSnrDb: 2.5,
    fresnelRatio: 0.6,
  }),
});

export type HighlandTheme = typeof HIGHLAND_THEME;
