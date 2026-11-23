/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Crisp 1.5px Monochrome Geometric Inline SVG Icon Kit
 *
 * Requirements & Invariants:
 * 1. Strict Zero-AI-Slop & Zero-Emoji mandate: Pure geometric SVG paths only.
 * 2. 16x16 coordinate space, viewBox="0 0 16 16", stroke="currentColor", stroke-width="1.5".
 * 3. XSS-safe: Whitelisted icon keys with safe fallback, attributes escaped via `src/ui/domSafety.ts`.
 * 4. Zero runtime dependencies, Object.freeze() immutable registry.
 */

import { escapeAttr, trustedHtml, TrustedHtml } from './domSafety';

// -----------------------------------------------------------------------------
// Icon Key Definitions
// -----------------------------------------------------------------------------

export type TacticalTransportIcon =
  | 'play'
  | 'pause'
  | 'step'
  | 'reset'
  | 'speed';

export type TacticalViewIcon =
  | 'map2d'
  | 'cube3d'
  | 'splitView'
  | 'panelLeft'
  | 'panelRight'
  | 'dockBottom'
  | 'close'
  | 'chevronDown'
  | 'chevronRight';

export type TacticalToolIcon =
  | 'layers'
  | 'terrain'
  | 'probe'
  | 'ruler'
  | 'swath'
  | 'cadBox'
  | 'viewshed'
  | 'waypoint'
  | 'pathfinder'
  | 'jammer'
  | 'traffic';

export type TacticalDomainIcon =
  | 'rfLink'
  | 'antenna'
  | 'waveform'
  | 'packet'
  | 'queue'
  | 'shield'
  | 'satellite'
  | 'terminal'
  | 'soldierEud'
  | 'benchmark'
  | 'cvdEye'
  | 'download'
  | 'upload'
  | 'alert'
  | 'check';

export type TacticalIconName =
  | TacticalTransportIcon
  | TacticalViewIcon
  | TacticalToolIcon
  | TacticalDomainIcon;

// -----------------------------------------------------------------------------
// Pure Geometric SVG Icon Registry (16x16 viewBox, stroke-width 1.5)
// -----------------------------------------------------------------------------

export const TACTICAL_ICONS: Readonly<Record<TacticalIconName, string>> = Object.freeze({
  // Transport Controls
  play: '<polygon points="5 3.5 13 8 5 12.5 5 3.5" />',
  pause: '<line x1="5.5" y1="3.5" x2="5.5" y2="12.5" /><line x1="10.5" y1="3.5" x2="10.5" y2="12.5" />',
  step: '<polygon points="4 3.5 10 8 4 12.5 4 3.5" /><line x1="12" y1="3.5" x2="12" y2="12.5" />',
  reset: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2 6.2" /><polyline points="2 2.5 2 6.5 6 6.5" />',
  speed: '<circle cx="8" cy="8" r="6" /><polyline points="8 4.5 8 8 10.5 9.5" />',

  // Views & Panels
  map2d: '<polygon points="2 4 6 2.5 10 4 14 2.5 14 12 10 13.5 6 12 2 13.5 2 4" /><line x1="6" y1="2.5" x2="6" y2="12" /><line x1="10" y1="4" x2="10" y2="13.5" />',
  cube3d: '<polygon points="8 1.5 14 4.8 14 11.2 8 14.5 2 11.2 2 4.8 8 1.5" /><line x1="8" y1="1.5" x2="8" y2="14.5" /><line x1="8" y1="8" x2="14" y2="4.8" /><line x1="8" y1="8" x2="2" y2="4.8" />',
  splitView: '<rect x="2" y="2.5" width="12" height="11" rx="1.5" /><line x1="8" y1="2.5" x2="8" y2="13.5" />',
  panelLeft: '<rect x="2" y="2.5" width="12" height="11" rx="1.5" /><line x1="6" y1="2.5" x2="6" y2="13.5" />',
  panelRight: '<rect x="2" y="2.5" width="12" height="11" rx="1.5" /><line x1="10" y1="2.5" x2="10" y2="13.5" />',
  dockBottom: '<rect x="2" y="2.5" width="12" height="11" rx="1.5" /><line x1="2" y1="10" x2="14" y2="10" />',
  close: '<line x1="3.5" y1="3.5" x2="12.5" y2="12.5" /><line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />',
  chevronDown: '<polyline points="3.5 6 8 10.5 12.5 6" />',
  chevronRight: '<polyline points="6 3.5 10.5 8 6 12.5" />',

  // Tactical Tools
  layers: '<polygon points="8 1.5 14 4.5 8 7.5 2 4.5 8 1.5" /><polyline points="2 8 8 11 14 8" /><polyline points="2 11.5 8 14.5 14 11.5" />',
  terrain: '<polyline points="1.5 13.5 6 5.5 9 10 12 6.5 14.5 13.5 1.5 13.5" />',
  probe: '<circle cx="8" cy="8" r="5" /><line x1="8" y1="1" x2="8" y2="4" /><line x1="8" y1="12" x2="8" y2="15" /><line x1="1" y1="8" x2="4" y2="8" /><line x1="12" y1="8" x2="15" y2="8" /><circle cx="8" cy="8" r="1" fill="currentColor" />',
  ruler: '<rect x="2" y="5" width="12" height="6" rx="1" /><line x1="5" y1="5" x2="5" y2="8" /><line x1="8" y1="5" x2="8" y2="9" /><line x1="11" y1="5" x2="11" y2="8" />',
  swath: '<path d="M2.5 13.5 L4.5 4.5 L11.5 4.5 L13.5 13.5 Z" /><line x1="8" y1="4.5" x2="8" y2="13.5" stroke-dasharray="2 2" />',
  cadBox: '<rect x="3" y="3" width="10" height="10" rx="1" /><line x1="3" y1="10" x2="10" y2="3" /><line x1="6" y1="13" x2="13" y2="6" />',
  viewshed: '<path d="M2 13a8.5 8.5 0 0 1 12 0" /><path d="M4.5 13a5.5 5.5 0 0 1 7 0" /><path d="M7 13a2 2 0 0 1 2 0" /><circle cx="8" cy="13.5" r="0.75" fill="currentColor" />',
  waypoint: '<circle cx="8" cy="6" r="3.5" /><path d="M8 9.5 L8 14.5" /><circle cx="8" cy="14.5" r="1" fill="currentColor" />',
  pathfinder: '<polyline points="3 13 7 9 9 12 13 4" /><circle cx="3" cy="13" r="1.5" /><circle cx="13" cy="4" r="1.5" />',
  jammer: '<polygon points="9 1.5 4.5 8.5 7.5 8.5 6.5 14.5 12 7.5 9 7.5 9 1.5" />',
  traffic: '<polyline points="10 2 13.5 5 10 8" /><line x1="2.5" y1="5" x2="13" y2="5" /><polyline points="6 14 2.5 11 6 8" /><line x1="13.5" y1="11" x2="3" y2="11" />',

  // RF / Network / Lab
  rfLink: '<circle cx="4" cy="12" r="2" /><circle cx="12" cy="4" r="2" /><path d="M5.5 10.5 C6.5 7.5 8.5 5.5 10.5 4.5" /><path d="M4 8a4 4 0 0 1 4-4" stroke-dasharray="1.5 1.5" />',
  antenna: '<line x1="8" y1="5" x2="8" y2="14.5" /><line x1="5" y1="14.5" x2="11" y2="14.5" /><path d="M4 3a6 6 0 0 1 8 0" /><path d="M5.5 5a3.5 3.5 0 0 1 5 0" /><circle cx="8" cy="6.5" r="1" fill="currentColor" />',
  waveform: '<path d="M1.5 8.5 Q 3.5 2.5, 5.5 8.5 T 9.5 8.5 T 13.5 8.5 L 14.5 8.5" />',
  packet: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" /><line x1="2.5" y1="7" x2="13.5" y2="7" /><line x1="6.5" y1="7" x2="6.5" y2="12.5" />',
  queue: '<rect x="2" y="3" width="12" height="2.5" rx="0.5" /><rect x="2" y="7" width="12" height="2.5" rx="0.5" /><rect x="2" y="11" width="12" height="2.5" rx="0.5" />',
  shield: '<path d="M8 2 L13.5 4.5 V8.5 C13.5 11.5 10.5 13.8 8 14.5 C5.5 13.8 2.5 11.5 2.5 8.5 V4.5 Z" />',
  satellite: '<rect x="6.5" y="6.5" width="3" height="3" /><line x1="1.5" y1="8" x2="6.5" y2="8" /><line x1="9.5" y1="8" x2="14.5" y2="8" /><rect x="1.5" y1="6" width="3" height="4" /><rect x="11.5" y1="6" width="3" height="4" /><circle cx="8" cy="4" r="1.5" />',
  terminal: '<polyline points="3 5 6.5 8 3 11" /><line x1="8.5" y1="12" x2="13" y2="12" />',
  soldierEud: '<rect x="4" y="2" width="8" height="12" rx="1.5" /><line x1="6" y1="11.5" x2="10" y2="11.5" /><line x1="4" y1="3.5" x2="2" y2="1.5" />',
  benchmark: '<circle cx="8" cy="8.5" r="5.5" /><polyline points="8 5.5 8 8.5 10.5 8.5" /><line x1="7" y1="1.5" x2="9" y2="1.5" /><line x1="8" y1="1.5" x2="8" y2="3" />',
  cvdEye: '<path d="M1.5 8 C3.5 4.5 12.5 4.5 14.5 8 C12.5 11.5 3.5 11.5 1.5 8 Z" /><circle cx="8" cy="8" r="2.5" /><circle cx="8" cy="8" r="1" fill="currentColor" />',
  download: '<polyline points="4.5 7.5 8 11 11.5 7.5" /><line x1="8" y1="2" x2="8" y2="11" /><path d="M2.5 12.5 v1.5 h11 v-1.5" />',
  upload: '<polyline points="4.5 5.5 8 2 11.5 5.5" /><line x1="8" y1="11" x2="8" y2="2" /><path d="M2.5 12.5 v1.5 h11 v-1.5" />',
  alert: '<polygon points="8 2 14.5 13.5 1.5 13.5" /><line x1="8" y1="6" x2="8" y2="9.5" /><circle cx="8" cy="11.5" r="0.75" fill="currentColor" />',
  check: '<polyline points="2.5 8.5 6 12 13.5 4.5" />',
});

/**
 * Fallback icon for unknown names: crisp neutral square outline.
 */
export const FALLBACK_TACTICAL_ICON = '<rect x="3" y="3" width="10" height="10" rx="1" />';

export interface TacticalIconOptions {
  size?: number;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

/**
 * Type guard to verify whether a string is a recognized tactical icon name.
 */
export function isTacticalIconName(name: string): name is TacticalIconName {
  return Object.prototype.hasOwnProperty.call(TACTICAL_ICONS, name);
}

/**
 * Returns the immutable list of all supported tactical icon names.
 */
export function getTacticalIconNames(): readonly TacticalIconName[] {
  return Object.keys(TACTICAL_ICONS) as TacticalIconName[];
}

/**
 * Renders an inline geometric tactical SVG icon as a verified `TrustedHtml` fragment.
 *
 * Safe by construction:
 * - Unknown names fall back to a neutral square outline (zero code injection).
 * - Attributes (class, title, aria-label) are strictly escaped via `escapeAttr`.
 * - Numeric size is sanitized and clamped to [8, 256] px (default 16px).
 * - Zero emojis, zero external font requests, zero scripts.
 */
export function renderTacticalIcon(
  name: TacticalIconName | string,
  options?: TacticalIconOptions
): TrustedHtml {
  const iconBody = isTacticalIconName(name)
    ? TACTICAL_ICONS[name]
    : FALLBACK_TACTICAL_ICON;

  const rawSize = options?.size;
  const size =
    typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize > 0
      ? Math.min(256, Math.max(8, Math.round(rawSize)))
      : 16;

  const classAttr = options?.className
    ? ` class="${escapeAttr(options.className)}"`
    : '';

  let accessibilityAttrs = ' aria-hidden="true"';
  let titleNode = '';

  if (options?.title) {
    accessibilityAttrs = ' role="img"';
    titleNode = `<title>${escapeAttr(options.title)}</title>`;
  } else if (options?.ariaLabel) {
    accessibilityAttrs = ` role="img" aria-label="${escapeAttr(options.ariaLabel)}"`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${classAttr}${accessibilityAttrs}>${titleNode}${iconBody}</svg>`;

  return trustedHtml(svg);
}
