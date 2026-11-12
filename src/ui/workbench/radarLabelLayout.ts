/**
 * Highland Instrument — Screen-Space Radar Label De-confliction
 *
 * Pure AABB collision-avoidance placer for `drawRadar()` so ACN telemetry tags,
 * ground terminal callsigns, and mountain peak labels never collide with each other
 * or clip outside canvas bounds.
 */

export interface LabelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LabelPlacementOptions {
  readonly paddingX?: number;
  readonly paddingY?: number;
  readonly viewportW: number;
  readonly viewportH: number;
  readonly margin?: number;
  readonly allowFallbackIfColliding?: boolean;
}

export interface LabelPlacementResult {
  readonly x: number;
  readonly y: number;
  readonly rect: LabelRect;
  readonly visible: boolean;
  readonly displaced: boolean;
}

export function rectsIntersect(a: LabelRect, b: LabelRect, padX = 3, padY = 2): boolean {
  return (
    a.x < b.x + b.w + padX &&
    a.x + a.w + padX > b.x &&
    a.y < b.y + b.h + padY &&
    a.y + a.h + padY > b.y
  );
}

export function isInsideViewport(rect: LabelRect, viewportW: number, viewportH: number, margin = 6): boolean {
  return (
    rect.x >= margin &&
    rect.y >= margin &&
    rect.x + rect.w <= viewportW - margin &&
    rect.y + rect.h <= viewportH - margin
  );
}

/**
 * Stateful priority-ordered screen-space label placer per animation frame.
 */
export class RadarLabelPlacer {
  private readonly placed: LabelRect[] = [];

  public reset(initialReserved: readonly LabelRect[] = []): void {
    this.placed.length = 0;
    for (const r of initialReserved) {
      this.placed.push(r);
    }
  }

  public reserve(rect: LabelRect): void {
    this.placed.push(rect);
  }

  public collides(candidate: LabelRect, padX = 3, padY = 2): boolean {
    for (let i = 0; i < this.placed.length; i++) {
      if (rectsIntersect(candidate, this.placed[i], padX, padY)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Attempts candidate offsets `(dx, dy)` in priority order around anchor `(ax, ay)`.
   * Each candidate produces top-left `(ax + dx, ay + dy)`.
   */
  public placeBox(
    ax: number,
    ay: number,
    w: number,
    h: number,
    candidates: readonly (readonly [number, number])[],
    opts: LabelPlacementOptions
  ): LabelPlacementResult {
    const padX = opts.paddingX ?? 3;
    const padY = opts.paddingY ?? 2;
    const margin = opts.margin ?? 6;

    for (let i = 0; i < candidates.length; i++) {
      const [dx, dy] = candidates[i];
      const rect: LabelRect = { x: ax + dx, y: ay + dy, w, h };
      if (!isInsideViewport(rect, opts.viewportW, opts.viewportH, margin)) continue;
      if (!this.collides(rect, padX, padY)) {
        this.placed.push(rect);
        return { x: rect.x, y: rect.y, rect, visible: true, displaced: i > 0 };
      }
    }

    if (opts.allowFallbackIfColliding) {
      const [dx, dy] = candidates[0] ?? [0, 0];
      const clampedX = Math.max(margin, Math.min(opts.viewportW - margin - w, ax + dx));
      const clampedY = Math.max(margin, Math.min(opts.viewportH - margin - h, ay + dy));
      const fallback: LabelRect = { x: clampedX, y: clampedY, w, h };
      this.placed.push(fallback);
      return { x: fallback.x, y: fallback.y, rect: fallback, visible: true, displaced: true };
    }

    const fallback: LabelRect = { x: ax, y: ay, w, h };
    return { x: ax, y: ay, rect: fallback, visible: false, displaced: false };
  }

  public getPlacedCount(): number {
    return this.placed.length;
  }
}

export function acnTagCandidateOffsets(boxW: number, boxH: number): readonly (readonly [number, number])[] {
  return [
    [16, -Math.round(boxH / 2)],          // Right of ACN (preferred)
    [16, 14],                              // Below-right
    [16, -(boxH + 14)],                    // Above-right
    [-(boxW + 16), -Math.round(boxH / 2)], // Left of ACN
    [-(boxW + 16), 14],                    // Below-left
    [-(boxW + 16), -(boxH + 14)],          // Above-left
  ];
}

export function nodeLabelCandidateOffsets(boxW: number, boxH: number): readonly (readonly [number, number])[] {
  return [
    [8, -Math.round(boxH / 2)],           // Right
    [8, 9],                               // Below-right
    [8, -(boxH + 6)],                     // Above-right
    [-(boxW + 8), -Math.round(boxH / 2)], // Left
    [-(boxW + 8), 9],                     // Below-left
    [-(boxW + 8), -(boxH + 6)],           // Above-left
    [-Math.round(boxW / 2), -(boxH + 9)], // Top centered
    [-Math.round(boxW / 2), 11],          // Bottom centered
  ];
}

export function summitLabelCandidateOffsets(boxW: number, boxH: number): readonly (readonly [number, number])[] {
  return [
    [7, -Math.round(boxH / 2)],            // Right
    [7, 7],                                // Below-right
    [-(boxW + 7), -Math.round(boxH / 2)],  // Left
    [-Math.round(boxW / 2), 9],            // Below
  ];
}
