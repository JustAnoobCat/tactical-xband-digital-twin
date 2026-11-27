/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * 2D Tactical Radar Geographic Cursor Readout (M7.2)
 *
 * Provides pure, allocation-conscious utilities to convert live radar cursor
 * coordinates into WGS-84 geographic coordinates (decimal and DMS) and query
 * terrain elevation MSL without loading or interfering with the 50 Hz worker simulation.
 */

import {
  cartesianToGeodetic,
  formatDmsComponent,
  formatGeodeticDecimal,
  formatGeodeticDms,
  GEODESY_ORIGIN_LAT_DEG,
  GEODESY_ORIGIN_LON_DEG,
  METERS_PER_DEG_LAT,
  METERS_PER_DEG_LON,
  DEM_MIN_LAT_DEG,
  DEM_MAX_LAT_DEG,
  DEM_MIN_LON_DEG,
  DEM_MAX_LON_DEG,
  DEM_COVERAGE_HALF_WIDTH_M,
  DEM_COVERAGE_HALF_HEIGHT_M,
} from '../core/geodesy';
import { THEATER_BIOMES, type BiomeId } from '../core/biomePhysics';
import { BIOME_DEM_METADATA } from '../core/terrain';
import { HIGHLAND_THEME } from './workbench/chartTheme';

export interface RadarCursorReadoutInput {
  /** Local Cartesian X coordinate in metres (+X East) */
  readonly xM: number;
  /** Local Cartesian Y coordinate in metres (+Y North) */
  readonly yM: number;
  /** Whether the pointer is inside the active radar canvas bounds */
  readonly isInsideRadar: boolean;
  /** Active terrain mode: 'real' | 'synthetic' */
  readonly terrainMode?: 'real' | 'synthetic';
  /** Optional elevation query function, returning elevation MSL in metres or NaN */
  readonly getElevation?: (xM: number, yM: number) => number;
  /** Optional coverage predicate */
  readonly isWithinCoverage?: (xM: number, yM: number) => boolean;
  /** Optional active theater biome for geodetic origin lookup */
  readonly biomeId?: BiomeId;
  /** Optional explicit geodetic origin latitude (degrees) */
  readonly originLatDeg?: number;
  /** Optional explicit geodetic origin longitude (degrees) */
  readonly originLonDeg?: number;
  /** Optional explicit coverage half-width (metres) */
  readonly halfWidthM?: number;
  /** Optional explicit coverage half-height (metres) */
  readonly halfHeightM?: number;
  /** Optional explicit half-span latitude (degrees) matching halfHeightM */
  readonly halfSpanLatDeg?: number;
  /** Optional explicit half-span longitude (degrees) matching halfWidthM */
  readonly halfSpanLonDeg?: number;
}

export interface RadarCursorReadoutResult {
  readonly isInsideRadar: boolean;
  readonly xM: number;
  readonly yM: number;
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly latDecimal: string;
  readonly lonDecimal: string;
  readonly latDms: string;
  readonly lonDms: string;
  readonly dmsFull: string;
  readonly isWithinCoverage: boolean;
  readonly terrainElevationMslM: number | null;
  readonly terrainElevationFormatted: string;
  readonly localCoordsFormatted: string;
  readonly hudLabel: string;
  readonly tooltipText: string;
}

/**
 * Computes live geographic coordinates, DMS strings, and terrain elevation
 * for the tactical radar cursor.
 */
export function computeRadarCursorReadout(input: RadarCursorReadoutInput): RadarCursorReadoutResult {
  const {
    xM,
    yM,
    isInsideRadar,
    terrainMode = 'real',
    getElevation,
    isWithinCoverage: customCoverageCheck,
    biomeId,
    originLatDeg,
    originLonDeg,
    halfWidthM,
    halfHeightM,
    halfSpanLatDeg,
    halfSpanLonDeg,
  } = input;

  if (!isInsideRadar || !Number.isFinite(xM) || !Number.isFinite(yM)) {
    return {
      isInsideRadar: false,
      xM: Number.NaN,
      yM: Number.NaN,
      latDeg: Number.NaN,
      lonDeg: Number.NaN,
      latDecimal: '--',
      lonDecimal: '--',
      latDms: '--',
      lonDms: '--',
      dmsFull: '--',
      isWithinCoverage: false,
      terrainElevationMslM: null,
      terrainElevationFormatted: '--',
      localCoordsFormatted: 'X: --  Y: --',
      hudLabel: 'CURSOR: OUTSIDE RADAR MAP',
      tooltipText: 'Pointer is outside the active radar coverage area.',
    };
  }

  // 1. Geodetic conversion via active biome/origin or authoritative Ladakh geodesy module
  const biomeDef = biomeId ? THEATER_BIOMES[biomeId] : undefined;
  const biomeMeta = biomeId ? BIOME_DEM_METADATA[biomeId] : undefined;
  const hasCustomOrigin = Number.isFinite(originLatDeg) && Number.isFinite(originLonDeg);

  const centerLat = hasCustomOrigin
    ? (originLatDeg as number)
    : (biomeDef ? biomeDef.centerLatDeg : GEODESY_ORIGIN_LAT_DEG);
  const centerLon = hasCustomOrigin
    ? (originLonDeg as number)
    : (biomeDef ? biomeDef.centerLonDeg : GEODESY_ORIGIN_LON_DEG);

  const useLadakhDefault =
    !hasCustomOrigin && (!biomeDef || biomeId === 'alpine_mountain') &&
    !Number.isFinite(halfWidthM) && !Number.isFinite(halfHeightM);

  const geo = useLadakhDefault
    ? cartesianToGeodetic(xM, yM)
    : (() => {
        const effMeta = hasCustomOrigin ? undefined : biomeMeta;
        const covHalfH = Number.isFinite(halfHeightM) && (halfHeightM as number) > 0
          ? (halfHeightM as number)
          : (effMeta?.halfHeightM ?? METERS_PER_DEG_LAT);
        const covHalfW = Number.isFinite(halfWidthM) && (halfWidthM as number) > 0
          ? (halfWidthM as number)
          : (effMeta?.halfWidthM ??
              (METERS_PER_DEG_LON / Math.cos((GEODESY_ORIGIN_LAT_DEG * Math.PI) / 180.0)) *
                Math.cos((centerLat * Math.PI) / 180.0));
        const spanLat = Number.isFinite(halfSpanLatDeg) && (halfSpanLatDeg as number) > 0
          ? (halfSpanLatDeg as number)
          : (effMeta ? (effMeta.maxLatDeg - effMeta.minLatDeg) * 0.5 : 1.0);
        const spanLon = Number.isFinite(halfSpanLonDeg) && (halfSpanLonDeg as number) > 0
          ? (halfSpanLonDeg as number)
          : (effMeta ? (effMeta.maxLonDeg - effMeta.minLonDeg) * 0.5 : 1.0);
        return {
          latDeg: centerLat + (yM / covHalfH) * spanLat,
          lonDeg: centerLon + (xM / covHalfW) * spanLon,
          isWithinCoverage: Math.abs(xM) <= covHalfW && Math.abs(yM) <= covHalfH,
        };
      })();
  const isCovered = customCoverageCheck
    ? customCoverageCheck(xM, yM)
    : geo.isWithinCoverage;

  const latDecimal = `${Math.abs(geo.latDeg).toFixed(5)}°${geo.latDeg >= 0 ? 'N' : 'S'}`;
  const lonDecimal = `${Math.abs(geo.lonDeg).toFixed(5)}°${geo.lonDeg >= 0 ? 'E' : 'W'}`;
  const latDms = formatDmsComponent(geo.latDeg, true);
  const lonDms = formatDmsComponent(geo.lonDeg, false);
  const dmsFull = `${latDms}, ${lonDms}`;

  // 2. Terrain elevation evaluation
  let terrainElevationMslM: number | null = null;
  let terrainElevationFormatted = 'N/A';

  if (getElevation) {
    const rawElev = getElevation(xM, yM);
    if (terrainMode === 'real') {
      // In real DEM mode: if outside coverage or NaN, strictly display N/A.
      // Never fabricate synthetic elevation in real DEM mode.
      if (isCovered && Number.isFinite(rawElev)) {
        terrainElevationMslM = rawElev;
        terrainElevationFormatted = `${Math.round(rawElev).toLocaleString('en-US')} m`;
      } else {
        terrainElevationMslM = null;
        terrainElevationFormatted = 'N/A';
      }
    } else {
      // Synthetic procedural mode
      if (Number.isFinite(rawElev)) {
        terrainElevationMslM = rawElev;
        terrainElevationFormatted = `${Math.round(rawElev).toLocaleString('en-US')} m`;
      } else {
        terrainElevationMslM = null;
        terrainElevationFormatted = 'N/A';
      }
    }
  } else {
    // If no elevation function is configured, mark unavailable
    terrainElevationFormatted = isCovered ? 'Pending DEM' : 'N/A';
  }

  // 3. Local Cartesian format (+X East, +Y North)
  const signX = xM >= 0 ? '+' : '';
  const signY = yM >= 0 ? '+' : '';
  const localCoordsFormatted = `X: ${signX}${Math.round(xM).toLocaleString('en-US')} m  Y: ${signY}${Math.round(yM).toLocaleString('en-US')} m`;

  // 4. Compact one-line HUD label
  const elevLabel = terrainElevationFormatted === 'N/A'
    ? 'N/A (Outside DEM)'
    : terrainElevationFormatted;
  const hudLabel = `LAT ${latDecimal}  LON ${lonDecimal} | TERRAIN MSL ${elevLabel} | LOCAL ${signX}${Math.round(xM)}m, ${signY}${Math.round(yM)}m`;

  // 5. Rich tooltip text for hover inspection
  const tooltipText = [
    `WGS-84 Coordinates: ${latDecimal}, ${lonDecimal}`,
    `DMS: ${dmsFull}`,
    `Terrain Elevation: ${terrainElevationMslM !== null ? `${Math.round(terrainElevationMslM).toLocaleString('en-US')} m MSL` : 'N/A (Outside DEM Coverage)'}`,
    `Local Theater Coordinates: ${localCoordsFormatted}`,
    `Projection: WGS-84 Local Equirectangular (Center ${Math.abs(centerLat).toFixed(1)}°${centerLat >= 0 ? 'N' : 'S'}, ${Math.abs(centerLon).toFixed(1)}°${centerLon >= 0 ? 'E' : 'W'})`,
  ].join('\n');

  return {
    isInsideRadar: true,
    xM,
    yM,
    latDeg: geo.latDeg,
    lonDeg: geo.lonDeg,
    latDecimal,
    lonDecimal,
    latDms,
    lonDms,
    dmsFull,
    isWithinCoverage: isCovered,
    terrainElevationMslM,
    terrainElevationFormatted,
    localCoordsFormatted,
    hudLabel,
    tooltipText,
  };
}

/**
 * Generates compact, high-contrast HTML markup for the tactical radar HUD overlay.
 */
export function renderCursorHudHtml(readout: RadarCursorReadoutResult): string {
  if (!readout.isInsideRadar) {
    return `<span style="color:${HIGHLAND_THEME.text.faint};display:inline-flex;align-items:center;gap:6px;"><span style="width:6px;height:6px;border-radius:50%;background:${HIGHLAND_THEME.signal.slate};"></span>CURSOR: OUTSIDE RADAR MAP</span>`;
  }

  const isOutOfCoverage = readout.terrainElevationFormatted === 'N/A' || !readout.isWithinCoverage;
  const elevStyle = isOutOfCoverage
    ? `color:${HIGHLAND_THEME.signal.ochre};font-weight:600;`
    : `color:${HIGHLAND_THEME.text.primary};font-weight:600;`;
  const elevText = isOutOfCoverage
    ? 'N/A (Outside DEM)'
    : readout.terrainElevationFormatted;

  return `
    <span style="display:inline-flex;align-items:center;gap:6px;">
      <span style="width:6px;height:6px;border-radius:50%;background:${HIGHLAND_THEME.signal.amber};box-shadow:0 0 6px ${HIGHLAND_THEME.signal.amber};"></span>
      <span style="color:${HIGHLAND_THEME.signal.amber};font-weight:600;letter-spacing:0.02em;">${readout.latDecimal}, ${readout.lonDecimal}</span>
      <small class="radar-cursor-dms" style="color:${HIGHLAND_THEME.text.muted};font-size:10px;margin-left:2px;">(${readout.dmsFull})</small>
    </span>
    <span style="color:var(--hi-line-strong, #2e3440);user-select:none;">|</span>
    <span style="display:inline-flex;align-items:center;gap:4px;">
      <span style="color:${HIGHLAND_THEME.text.muted};font-size:10.5px;">Terrain MSL:</span>
      <span style="${elevStyle}">${elevText}</span>
    </span>
    <span class="radar-cursor-local-sep" style="color:var(--hi-line-strong, #2e3440);user-select:none;">|</span>
    <span class="radar-cursor-local" style="color:${HIGHLAND_THEME.text.faint};font-size:10.5px;">${readout.localCoordsFormatted}</span>
  `.trim();
}

