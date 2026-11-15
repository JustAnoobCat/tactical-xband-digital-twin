/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * MapLibre Subsystem Controller & Screen Projection Seam (M7.2)
 *
 * Implements high-performance screen-space projection from authoritative local Cartesian
 * ENU coordinates to MapLibre container pixels via WGS-84 Plate Carrée geodesy.
 * Powers 60 FPS transparent kinetic canvas animation overlays above MapLibre.
 */

import { cartesianToGeodetic } from '../core/geodesy';

export class MapController {
  private map: any;

  constructor(mapInstance?: any) {
    this.map = mapInstance ?? null;
  }

  public setMapInstance(mapInstance: any): void {
    this.map = mapInstance;
  }

  public getMapInstance(): any {
    return this.map;
  }

  /**
   * Projects local ENU Cartesian coordinates (xM, yM in metres) to screen container point { x, y }
   * via WGS-84 geodetic conversion and MapLibre map.project([lon, lat]).
   * Returns null if MapLibre instance is unavailable or point projection fails.
   */
  public projectEnuToContainerPoint(xM: number, yM: number): { x: number; y: number } | null {
    if (!this.map || typeof this.map.project !== 'function') {
      return null;
    }
    try {
      const geo = cartesianToGeodetic(xM, yM);
      const pt = this.map.project([geo.lonDeg, geo.latDeg]);
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        return null;
      }
      return { x: pt.x, y: pt.y };
    } catch {
      return null;
    }
  }
}
