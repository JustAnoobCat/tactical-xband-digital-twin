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
 * - BLOCKED_OBSTACLE:    Short-dotted line [2, 4]
 * - OUTAGE_DISCONNECTED: Spaced-dashed line [3, 6]
 * - UNKNOWN:             Sparse-dotted line [1, 5]
 */

import {
  classifyLinkCommunicationStatus,
  LinkCommunicationStatus,
  LinkStatusClassification,
  LinkStatusTelemetryInput,
} from '../core/linkStatusClassifier';
import { HIGHLAND_THEME } from './workbench/chartTheme';

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
    strokeColor: HIGHLAND_THEME.signal.sageStrokeSoft,
    selectedStrokeColor: HIGHLAND_THEME.signal.sageBright,
    lineWidth: 1.2,
    selectedLineWidth: 2.6,
    lineDash: HIGHLAND_THEME.dash.solid,
    nodeColor: HIGHLAND_THEME.signal.sage,
    statusLabel: 'CONNECTED',
    badgeColor: HIGHLAND_THEME.signal.sage,
    patternDescription: 'Solid line',
  }),

  DEGRADED: Object.freeze({
    status: 'DEGRADED',
    strokeColor: HIGHLAND_THEME.signal.ochreStrokeSoft,
    selectedStrokeColor: HIGHLAND_THEME.signal.amberBright,
    lineWidth: 1.4,
    selectedLineWidth: 2.8,
    lineDash: HIGHLAND_THEME.dash.degraded,
    nodeColor: HIGHLAND_THEME.signal.ochre,
    statusLabel: 'DEGRADED',
    badgeColor: HIGHLAND_THEME.signal.ochre,
    patternDescription: 'Long-dashed line',
  }),

  BLOCKED_TERRAIN: Object.freeze({
    status: 'BLOCKED_TERRAIN',
    strokeColor: HIGHLAND_THEME.signal.vermilionStrokeSoft,
    selectedStrokeColor: HIGHLAND_THEME.signal.vermilionBright,
    lineWidth: 1.3,
    selectedLineWidth: 2.6,
    lineDash: HIGHLAND_THEME.dash.blockedTerrain,
    nodeColor: HIGHLAND_THEME.signal.vermilion,
    statusLabel: 'BLOCKED (TERRAIN)',
    badgeColor: HIGHLAND_THEME.signal.vermilion,
    patternDescription: 'Medium-dashed line',
  }),

  BLOCKED_OBSTACLE: Object.freeze({
    status: 'BLOCKED_OBSTACLE',
    strokeColor: HIGHLAND_THEME.signal.copperStrokeSoft,
    selectedStrokeColor: HIGHLAND_THEME.signal.copperBright,
    lineWidth: 1.5,
    selectedLineWidth: 2.8,
    lineDash: HIGHLAND_THEME.dash.blockedObstacle,
    nodeColor: HIGHLAND_THEME.signal.copper,
    statusLabel: 'BLOCKED (OBSTACLE)',
    badgeColor: HIGHLAND_THEME.signal.copper,
    patternDescription: 'Dotted line',
  }),

  OUTAGE_DISCONNECTED: Object.freeze({
    status: 'OUTAGE_DISCONNECTED',
    strokeColor: HIGHLAND_THEME.signal.ashStrokeSoft,
    selectedStrokeColor: '#9ca3af',
    lineWidth: 1.1,
    selectedLineWidth: 2.2,
    lineDash: HIGHLAND_THEME.dash.outage,
    nodeColor: HIGHLAND_THEME.signal.ash,
    statusLabel: 'OUTAGE (DISCONNECTED)',
    badgeColor: HIGHLAND_THEME.signal.ash,
    patternDescription: 'Spaced-dashed line',
  }),

  UNKNOWN: Object.freeze({
    status: 'UNKNOWN',
    strokeColor: HIGHLAND_THEME.signal.slateStrokeSoft,
    selectedStrokeColor: HIGHLAND_THEME.text.faint,
    lineWidth: 1.0,
    selectedLineWidth: 2.0,
    lineDash: HIGHLAND_THEME.dash.unknown,
    nodeColor: HIGHLAND_THEME.signal.slate,
    statusLabel: 'UNKNOWN (UNVERIFIED)',
    badgeColor: '#646c78',
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

