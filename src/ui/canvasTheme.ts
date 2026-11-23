/**
 * src/ui/canvasTheme.ts
 *
 * Zero-Allocation Matte Lattice Obsidian Canvas Palette Registry.
 * Synchronizes 2D tactical scopes, HUDs, EUD compass, and data-comm renderers
 * with CSS tokens in frontend/c2-console-theme.css and WP-10 CVD calibration.
 */

export type CanvasCvdMode = 'standard' | 'colorblind-safe';

export interface LatticeCanvasPalette {
  readonly mode: CanvasCvdMode;
  readonly voidBg: string;
  readonly panelBg: string;
  readonly cardBg: string;
  readonly gridMajor: string;
  readonly gridMinor: string;
  readonly axisStroke: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly accentFill: string;
  readonly optimal: string;
  readonly degraded: string;
  readonly critical: string;
  readonly outage: string;
  readonly relay: string;
}

export const LATTICE_CANVAS_STANDARD: LatticeCanvasPalette = Object.freeze({
  mode: 'standard',
  voidBg: '#080a0d',
  panelBg: '#0d1015',
  cardBg: '#12161d',
  gridMajor: '#222a36',
  gridMinor: '#19202a',
  axisStroke: '#3b4b61',
  textPrimary: '#e6edf3',
  textSecondary: '#9ba8ba',
  textMuted: '#78879c',
  accent: '#38bdf8',
  accentFill: 'rgba(56, 189, 248, 0.14)',
  optimal: '#22c55e',
  degraded: '#eab308',
  critical: '#f97316',
  outage: '#ef4444',
  relay: '#3b82f6',
});

export const LATTICE_CANVAS_CVD: LatticeCanvasPalette = Object.freeze({
  mode: 'colorblind-safe',
  voidBg: '#080a0d',
  panelBg: '#0d1015',
  cardBg: '#12161d',
  gridMajor: '#222a36',
  gridMinor: '#19202a',
  axisStroke: '#3b4b61',
  textPrimary: '#e6edf3',
  textSecondary: '#9ba8ba',
  textMuted: '#78879c',
  accent: '#38bdf8',
  accentFill: 'rgba(56, 189, 248, 0.14)',
  optimal: '#4ade80',
  degraded: '#facc15',
  critical: '#fb923c',
  outage: '#ec4899',
  relay: '#818cf8',
});

export function readActiveCanvasCvdMode(): CanvasCvdMode {
  try {
    if (typeof document !== 'undefined' && document.documentElement?.dataset?.cvdMode === 'colorblind-safe') {
      return 'colorblind-safe';
    }
  } catch {
    // Headless / Node fallback
  }
  return 'standard';
}

export function getLatticeCanvasPalette(modeOverride?: CanvasCvdMode): LatticeCanvasPalette {
  const mode = modeOverride ?? readActiveCanvasCvdMode();
  return mode === 'colorblind-safe' ? LATTICE_CANVAS_CVD : LATTICE_CANVAS_STANDARD;
}
