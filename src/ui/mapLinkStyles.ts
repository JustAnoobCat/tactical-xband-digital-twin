/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Pure Tactical Map Communication Link Style Mapping (Milestone 4 Step 3)
 *
 * Maps authoritative communication link status classifications into distinct,
 * consistent visual styles for the 2D Tactical Radar Map canvas.
 *
 * Distinguishability without relying solely on color (accessible & monochrome-safe):
 * - CONNECTED:           Solid line []
 * - DEGRADED:            Long-dashed line [7, 3]
 * - BLOCKED_TERRAIN:     Medium-dashed line [4, 4]
 * - BLOCKED_OBSTACLE:    Short-dotted line [2, 3]
 * - OUTAGE_DISCONNECTED: Spaced-dashed line [3, 6]
 * - UNKNOWN:             Sparse-dotted line [1, 5]
 */

import {
  classifyLinkCommunicationStatus,
  LinkCommunicationStatus,
  LinkStatusClassification,
  LinkStatusTelemetryInput,
} from '../core/linkStatusClassifier';

export interface MapLinkStyle {
  readonly status: LinkCommunicationStatus;
  /** Primary stroke color for background / unselected link. */
  readonly strokeColor: string;
  /** High-contrast, higher-luminance stroke color for selected terminal link. */
  readonly selectedStrokeColor: string;
  /** Stroke line width in pixels for unselected link. */
  readonly lineWidth: number;
  /** Stroke line width in pixels for selected terminal link (drawn on top). */
  readonly selectedLineWidth: number;
  /** Canvas line dash pattern (e.g. [] for solid, [4, 4] for dashed, etc.). */
  readonly lineDash: readonly number[];
  /** Color of the ground terminal node marker on the tactical map. */
  readonly nodeColor: string;
  /** Concise badge / HUD label for display in map callouts and reticles. */
  readonly statusLabel: string;
  /** Accent color for reticle bracket corners, badge pills, and callout borders. */
  readonly badgeColor: string;
  /** Human-readable description of line pattern for accessibility and tooltips. */
  readonly patternDescription: string;
}

/**
 * Authoritative visual configuration table for all 6 link statuses.
 */
export const MAP_LINK_STYLES: Readonly<Record<LinkCommunicationStatus, MapLinkStyle>> = Object.freeze({
  CONNECTED: Object.freeze({
    status: 'CONNECTED',
    strokeColor: 'rgba(56, 189, 248, 0.45)', // Clear cyan
    selectedStrokeColor: '#38bdf8',           // Solid intense cyan
    lineWidth: 1.2,
    selectedLineWidth: 2.6,
    lineDash: Object.freeze([]),              // Solid line
    nodeColor: '#10b981',                     // Emerald healthy terminal
    statusLabel: 'CONNECTED',
    badgeColor: '#38bdf8',
    patternDescription: 'Solid line',
  }),

  DEGRADED: Object.freeze({
    status: 'DEGRADED',
    strokeColor: 'rgba(245, 158, 11, 0.65)', // Amber
    selectedStrokeColor: '#fbbf24',           // Solid bright amber
    lineWidth: 1.4,
    selectedLineWidth: 2.8,
    lineDash: Object.freeze([7, 3]),          // Long dash
    nodeColor: '#f59e0b',                     // Amber terminal
    statusLabel: 'DEGRADED',
    badgeColor: '#f59e0b',
    patternDescription: 'Long-dashed line',
  }),

  BLOCKED_TERRAIN: Object.freeze({
    status: 'BLOCKED_TERRAIN',
    strokeColor: 'rgba(239, 68, 68, 0.65)',  // Red
    selectedStrokeColor: '#f87171',           // Bright red
    lineWidth: 1.3,
    selectedLineWidth: 2.6,
    lineDash: Object.freeze([4, 4]),          // Medium dash
    nodeColor: '#ef4444',                     // Crimson terminal
    statusLabel: 'BLOCKED (TERRAIN)',
    badgeColor: '#ef4444',
    patternDescription: 'Medium-dashed line',
  }),

  BLOCKED_OBSTACLE: Object.freeze({
    status: 'BLOCKED_OBSTACLE',
    strokeColor: 'rgba(249, 115, 22, 0.70)', // Orange
    selectedStrokeColor: '#fb923c',           // Bright tactical orange
    lineWidth: 1.5,
    selectedLineWidth: 2.8,
    lineDash: Object.freeze([2, 3]),          // Short dots
    nodeColor: '#f97316',                     // Orange terminal
    statusLabel: 'BLOCKED (OBSTACLE)',
    badgeColor: '#f97316',
    patternDescription: 'Dotted line',
  }),

  OUTAGE_DISCONNECTED: Object.freeze({
    status: 'OUTAGE_DISCONNECTED',
    strokeColor: 'rgba(100, 116, 139, 0.45)', // Muted slate grey
    selectedStrokeColor: '#94a3b8',           // Slate grey
    lineWidth: 1.1,
    selectedLineWidth: 2.2,
    lineDash: Object.freeze([3, 6]),          // Spaced dash
    nodeColor: '#64748b',                     // Muted grey terminal
    statusLabel: 'OUTAGE (DISCONNECTED)',
    badgeColor: '#94a3b8',
    patternDescription: 'Spaced-dashed line',
  }),

  UNKNOWN: Object.freeze({
    status: 'UNKNOWN',
    strokeColor: 'rgba(71, 85, 105, 0.35)',  // Neutral dark steel
    selectedStrokeColor: '#64748b',           // Steel grey
    lineWidth: 1.0,
    selectedLineWidth: 2.0,
    lineDash: Object.freeze([1, 5]),          // Sparse dots
    nodeColor: '#475569',                     // Dark neutral
    statusLabel: 'UNKNOWN (UNVERIFIED)',
    badgeColor: '#64748b',
    patternDescription: 'Sparse-dotted line',
  }),
});

/**
 * Returns the authoritative MapLinkStyle for a given link status.
 * Safely defaults to UNKNOWN style if status is null, undefined, or unrecognized.
 */
export function getMapLinkStyle(status: LinkCommunicationStatus | string | null | undefined): MapLinkStyle {
  if (status && Object.prototype.hasOwnProperty.call(MAP_LINK_STYLES, status)) {
    return MAP_LINK_STYLES[status as LinkCommunicationStatus];
  }
  return MAP_LINK_STYLES.UNKNOWN;
}

/**
 * Evaluates node telemetry and returns both the authoritative classification and map style.
 */
export function classifyAndStyleLink(
  nodeTelemetry: LinkStatusTelemetryInput | null | undefined
): {
  readonly classification: LinkStatusClassification;
  readonly style: MapLinkStyle;
} {
  const classification = classifyLinkCommunicationStatus(nodeTelemetry);
  const style = getMapLinkStyle(classification.status);
  return { classification, style };
}

export interface StatusBadgeInfo {
  readonly status: LinkCommunicationStatus;
  readonly badgeClass: string;
  readonly badgeText: string;
  readonly badgeColor: string;
}

/**
 * Returns consistent UI badge class and display label for a link communication status.
 */
export function getStatusBadgeInfo(
  status: LinkCommunicationStatus | string | null | undefined
): StatusBadgeInfo {
  const style = getMapLinkStyle(status as LinkCommunicationStatus);
  let badgeClass = 'kpi-badge badge-neutral';
  switch (style.status) {
    case 'CONNECTED':
      badgeClass = 'kpi-badge badge-cyan';
      break;
    case 'DEGRADED':
      badgeClass = 'kpi-badge badge-amber';
      break;
    case 'BLOCKED_TERRAIN':
      badgeClass = 'kpi-badge badge-crimson';
      break;
    case 'BLOCKED_OBSTACLE':
      badgeClass = 'kpi-badge badge-amber';
      break;
    case 'OUTAGE_DISCONNECTED':
      badgeClass = 'kpi-badge badge-slate';
      break;
    case 'UNKNOWN':
    default:
      badgeClass = 'kpi-badge badge-neutral';
      break;
  }
  return {
    status: style.status,
    badgeClass,
    badgeText: style.statusLabel,
    badgeColor: style.badgeColor,
  };
}

