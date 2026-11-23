/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * 2D Canvas Screen-Space Label De-Cluttering Engine
 *
 * Implements authoritative, deterministic AABB collision-avoidance label placement
 * for the 2D Tactical Radar canvas and overlay callouts.
 *
 * Zero-dependency, pure, deterministic (< 50 µs/frame budget for 25 simultaneous callouts).
 */

export interface PlacedLabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly displaced: boolean;
  readonly displacementPx: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CanvasLabelPlacer {
  reserveRect(x: number, y: number, width: number, height: number): void;
  placeLabel(
    preferredX: number,
    preferredY: number,
    width: number,
    height: number,
    anchorX?: number,
    anchorY?: number
  ): PlacedLabelBox;
  getPlacedCount(): number;
  computeTotalOverlapArea(): number;
}

function computeIntersectionArea(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): number {
  const ox = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const oy = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  return ox * oy;
}

class CanvasLabelPlacerImpl implements CanvasLabelPlacer {
  private readonly vW: number;
  private readonly vH: number;
  private readonly pad: number;
  private readonly margin: number;

  // Stride 6 flat typed array: [x, y, right, bottom, width, height]
  private readonly placedCoords: Float64Array;
  private placedCount = 0;

  // Stride 6 flat typed array for exclusion zones
  private readonly resCoords: Float64Array;
  private resCount = 0;

  private readonly placed: PlacedLabelBox[] = [];

  constructor(
    viewportWidth: number,
    viewportHeight: number,
    paddingPx = 4,
    marginPx = 3
  ) {
    this.vW = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 800;
    this.vH = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 600;
    this.pad = Number.isFinite(paddingPx) && paddingPx >= 0 ? paddingPx : 4;
    this.margin = Number.isFinite(marginPx) && marginPx >= 0 ? marginPx : 3;

    this.placedCoords = new Float64Array(384); // Capacity for 64 callout labels
    this.resCoords = new Float64Array(96);     // Capacity for 16 reserved exclusion rects
  }

  public reserveRect(x: number, y: number, width: number, height: number): void {
    const safeX = Number.isFinite(x) ? x : 0;
    const safeY = Number.isFinite(y) ? y : 0;
    const safeW = Number.isFinite(width) && width > 0 ? width : 0;
    const safeH = Number.isFinite(height) && height > 0 ? height : 0;
    if (safeW > 0 && safeH > 0) {
      const idx = this.resCount * 6;
      if (idx + 6 <= this.resCoords.length) {
        this.resCoords[idx] = safeX;
        this.resCoords[idx + 1] = safeY;
        this.resCoords[idx + 2] = safeX + safeW;
        this.resCoords[idx + 3] = safeY + safeH;
        this.resCoords[idx + 4] = safeW;
        this.resCoords[idx + 5] = safeH;
        this.resCount++;
      }
    }
  }

  private collidesWithAny(x: number, y: number, w: number, h: number): boolean {
    const left = x - this.margin;
    const right = x + w + this.margin;
    const top = y - this.margin;
    const bottom = y + h + this.margin;

    const pLimit = this.placedCount * 6;
    const pCoords = this.placedCoords;
    for (let i = 0; i < pLimit; i += 6) {
      if (top < pCoords[i + 3] && bottom > pCoords[i + 1] && left < pCoords[i + 2] && right > pCoords[i]) {
        return true;
      }
    }

    const rLimit = this.resCount * 6;
    const rCoords = this.resCoords;
    for (let i = 0; i < rLimit; i += 6) {
      if (top < rCoords[i + 3] && bottom > rCoords[i + 1] && left < rCoords[i + 2] && right > rCoords[i]) {
        return true;
      }
    }

    return false;
  }

  private totalCandidateOverlap(x: number, y: number, w: number, h: number): number {
    let area = 0;
    const pLimit = this.placedCount * 6;
    const pCoords = this.placedCoords;
    for (let i = 0; i < pLimit; i += 6) {
      area += computeIntersectionArea(x, y, w, h, pCoords[i], pCoords[i + 1], pCoords[i + 4], pCoords[i + 5]);
    }
    const rLimit = this.resCount * 6;
    const rCoords = this.resCoords;
    for (let i = 0; i < rLimit; i += 6) {
      area += computeIntersectionArea(x, y, w, h, rCoords[i], rCoords[i + 1], rCoords[i + 4], rCoords[i + 5]);
    }
    return area;
  }

  public placeLabel(
    preferredX: number,
    preferredY: number,
    width: number,
    height: number,
    anchorX?: number,
    anchorY?: number
  ): PlacedLabelBox {
    const prefX = Number.isFinite(preferredX) ? preferredX : 0;
    const prefY = Number.isFinite(preferredY) ? preferredY : 0;
    const w = Number.isFinite(width) && width > 0 ? width : 0;
    const h = Number.isFinite(height) && height > 0 ? height : 0;
    const ax = Number.isFinite(anchorX) ? (anchorX as number) : (prefX + w / 2);
    const ay = Number.isFinite(anchorY) ? (anchorY as number) : (prefY + h / 2);

    const minX = this.pad;
    const maxX = this.vW - w - this.pad > minX ? this.vW - w - this.pad : minX;
    const minY = this.pad;
    const maxY = this.vH - h - this.pad > minY ? this.vH - h - this.pad : minY;

    const initX = prefX < minX ? minX : (prefX > maxX ? maxX : prefX);
    const initY = prefY < minY ? minY : (prefY > maxY ? maxY : prefY);

    // 1. Initial attempt at preferred position
    if (!this.collidesWithAny(initX, initY, w, h)) {
      const result: PlacedLabelBox = {
        x: initX,
        y: initY,
        width: w,
        height: h,
        displaced: false,
        displacementPx: 0,
        anchorX: ax,
        anchorY: ay,
      };
      this.recordPlaced(initX, initY, w, h, result);
      return result;
    }

    // 2. Concentric expanding 8-direction rings (1..4)
    const dxBase = w + this.margin * 2;
    const dyBase = h + this.margin * 2;

    let bestZeroX = 0;
    let bestZeroY = 0;
    let hasZero = false;
    let bestZeroDistSq = Infinity;

    for (let r = 1; r <= 4; r++) {
      const stepX = r * dxBase;
      const stepY = r * dyBase;
      const minPossibleDistSq = stepX < stepY ? stepX * stepX : stepY * stepY;

      // 4 Cardinal directions: Up, Down, Right, Left
      for (let d = 0; d < 4; d++) {
        let rawX = prefX;
        let rawY = prefY;
        if (d === 0) rawY -= stepY;       // Up
        else if (d === 1) rawY += stepY;  // Down
        else if (d === 2) rawX += stepX;  // Right
        else rawX -= stepX;               // Left

        const candX = rawX < minX ? minX : (rawX > maxX ? maxX : rawX);
        const candY = rawY < minY ? minY : (rawY > maxY ? maxY : rawY);

        if (!this.collidesWithAny(candX, candY, w, h)) {
          const dX = candX - prefX;
          const dY = candY - prefY;
          const distSq = dX * dX + dY * dY;
          if (distSq < bestZeroDistSq - 1e-6) {
            bestZeroDistSq = distSq;
            bestZeroX = candX;
            bestZeroY = candY;
            hasZero = true;
            if (distSq <= minPossibleDistSq + 1e-6) {
              break;
            }
          }
        }
      }

      // If no cardinal direction was free, test the 4 diagonals
      if (!hasZero) {
        for (let d = 0; d < 4; d++) {
          let rawX = prefX;
          let rawY = prefY;
          if (d === 0) { rawX += stepX; rawY -= stepY; }      // Up-Right
          else if (d === 1) { rawX -= stepX; rawY -= stepY; } // Up-Left
          else if (d === 2) { rawX += stepX; rawY += stepY; } // Down-Right
          else { rawX -= stepX; rawY += stepY; }              // Down-Left

          const candX = rawX < minX ? minX : (rawX > maxX ? maxX : rawX);
          const candY = rawY < minY ? minY : (rawY > maxY ? maxY : rawY);

          if (!this.collidesWithAny(candX, candY, w, h)) {
            const dX = candX - prefX;
            const dY = candY - prefY;
            const distSq = dX * dX + dY * dY;
            if (distSq < bestZeroDistSq - 1e-6) {
              bestZeroDistSq = distSq;
              bestZeroX = candX;
              bestZeroY = candY;
              hasZero = true;
            }
          }
        }
      }

      if (hasZero) {
        break;
      }
    }

    let finalX = 0;
    let finalY = 0;

    if (hasZero) {
      finalX = bestZeroX;
      finalY = bestZeroY;
    } else {
      // Complete saturation fallback: find candidate in rings 1..4 minimizing total overlap area
      let bestOverlapX = initX;
      let bestOverlapY = initY;
      let bestOverlapArea = this.totalCandidateOverlap(initX, initY, w, h);
      let bestOverlapDistSq = (initX - prefX) * (initX - prefX) + (initY - prefY) * (initY - prefY);

      for (let r = 1; r <= 4; r++) {
        const stepX = r * dxBase;
        const stepY = r * dyBase;
        for (let d = 0; d < 8; d++) {
          let rawX = prefX;
          let rawY = prefY;
          if (d === 0) rawY -= stepY;
          else if (d === 1) rawY += stepY;
          else if (d === 2) rawX += stepX;
          else if (d === 3) rawX -= stepX;
          else if (d === 4) { rawX += stepX; rawY -= stepY; }
          else if (d === 5) { rawX -= stepX; rawY -= stepY; }
          else if (d === 6) { rawX += stepX; rawY += stepY; }
          else { rawX -= stepX; rawY += stepY; }

          const candX = rawX < minX ? minX : (rawX > maxX ? maxX : rawX);
          const candY = rawY < minY ? minY : (rawY > maxY ? maxY : rawY);
          const area = this.totalCandidateOverlap(candX, candY, w, h);
          const dX = candX - prefX;
          const dY = candY - prefY;
          const distSq = dX * dX + dY * dY;

          if (area < bestOverlapArea - 1e-6 || (Math.abs(area - bestOverlapArea) < 1e-6 && distSq < bestOverlapDistSq - 1e-6)) {
            bestOverlapArea = area;
            bestOverlapDistSq = distSq;
            bestOverlapX = candX;
            bestOverlapY = candY;
          }
        }
      }
      finalX = bestOverlapX;
      finalY = bestOverlapY;
    }

    const dispX = finalX - prefX;
    const dispY = finalY - prefY;
    const displacementPx = Math.sqrt(dispX * dispX + dispY * dispY);
    const displaced = displacementPx > 0.5;

    const result: PlacedLabelBox = {
      x: finalX,
      y: finalY,
      width: w,
      height: h,
      displaced,
      displacementPx,
      anchorX: ax,
      anchorY: ay,
    };
    this.recordPlaced(finalX, finalY, w, h, result);
    return result;
  }

  private recordPlaced(x: number, y: number, w: number, h: number, box: PlacedLabelBox): void {
    this.placed.push(box);
    const idx = this.placedCount * 6;
    if (idx + 6 <= this.placedCoords.length) {
      this.placedCoords[idx] = x;
      this.placedCoords[idx + 1] = y;
      this.placedCoords[idx + 2] = x + w;
      this.placedCoords[idx + 3] = y + h;
      this.placedCoords[idx + 4] = w;
      this.placedCoords[idx + 5] = h;
      this.placedCount++;
    }
  }

  public getPlacedCount(): number {
    return this.placed.length;
  }

  public computeTotalOverlapArea(): number {
    let total = 0;
    const n = this.placedCount;
    const coords = this.placedCoords;
    for (let i = 0; i < n; i++) {
      const idxA = i * 6;
      for (let j = i + 1; j < n; j++) {
        const idxB = j * 6;
        total += computeIntersectionArea(
          coords[idxA], coords[idxA + 1], coords[idxA + 4], coords[idxA + 5],
          coords[idxB], coords[idxB + 1], coords[idxB + 4], coords[idxB + 5]
        );
      }
    }
    return total;
  }
}

/**
 * Creates a pure, deterministic 2D screen-space label placer for an animation frame.
 */
export function createLabelPlacer(
  viewportWidth: number,
  viewportHeight: number,
  paddingPx = 4,
  marginPx = 3
): CanvasLabelPlacer {
  return new CanvasLabelPlacerImpl(viewportWidth, viewportHeight, paddingPx, marginPx);
}
