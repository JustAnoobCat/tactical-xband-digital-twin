/**
 * 3D Terrain Elevation Mesh Data Generator
 *
 * Encapsulates generation and packaging of the 512x512 elevation grid
 * for 3D Three.js terrain mesh rendering:
 * 1. Direct-copy raster extraction for real satellite DEMs matching the 512x512 matrix.
 * 2. Bilateral spatial sampling across terrain bounds for synthetic procedural or custom DEMs.
 * 3. Exact min/max elevation derivation and non-finite value handling.
 * 4. Transferable ArrayBuffer packaging for zero-copy worker-to-host IPC.
 */

import { TerrainBoundsTelemetry, TerrainEngine } from '../core/terrain';
import type { TerrainMeshDataReadyMessage } from '../shared/workerProtocol';

/**
 * Result of generating terrain elevation mesh data, containing
 * the protocol message and the transferable buffer list.
 */
export interface TerrainMeshGenerationResult {
  readonly message: TerrainMeshDataReadyMessage;
  readonly transferList: Transferable[];
}

/**
 * Dedicated terrain mesh generator. Pure generator with zero mutation of
 * SimulationWorkerManager state or simulation timestep.
 */
export class TerrainMeshGenerator {
  public static readonly DEFAULT_GRID_SIZE = 512;

  /**
   * Generates a 512x512 elevation grid from real DEM raster or synthetic bounding-box sampling.
   *
   * @param terrainEngine Authoritative terrain engine instance
   * @param requestId Optional inbound command request ID to correlate with host
   * @param gridSize Elevation matrix resolution (default 512)
   */
  public static generate(
    terrainEngine: TerrainEngine,
    requestId?: string | number,
    gridSize: number = TerrainMeshGenerator.DEFAULT_GRID_SIZE
  ): TerrainMeshGenerationResult {
    const isReal =
      terrainEngine.terrainMode === 'real' &&
      terrainEngine.hasRealDem &&
      terrainEngine.realDemGrid !== null;
    const bounds = terrainEngine.getTerrainBoundsTelemetry();
    const transferGrid = new Float32Array(gridSize * gridSize);

    let minElev = Number.POSITIVE_INFINITY;
    let maxElev = Number.NEGATIVE_INFINITY;

    if (
      isReal &&
      terrainEngine.realDemGrid &&
      terrainEngine.realDemGrid.length === gridSize * gridSize
    ) {
      // Direct 512x512 copy
      transferGrid.set(terrainEngine.realDemGrid);
      for (let i = 0; i < transferGrid.length; i++) {
        const v = transferGrid[i];
        if (Number.isFinite(v)) {
          if (v < minElev) minElev = v;
          if (v > maxElev) maxElev = v;
        }
      }
    } else {
      // Synthetic procedural mode or custom resolution DEM: sample 512x512 matrix over bounds
      const stepX = (bounds.maxX - bounds.minX) / (gridSize - 1.0);
      const stepY = (bounds.maxY - bounds.minY) / (gridSize - 1.0);
      for (let r = 0; r < gridSize; r++) {
        const yM = bounds.maxY - r * stepY; // Row 0 is North (+Y)
        for (let c = 0; c < gridSize; c++) {
          const xM = bounds.minX + c * stepX; // Col 0 is West (-X)
          const v = terrainEngine.getElevation(xM, yM);
          const val = Number.isFinite(v) ? v : 0;
          transferGrid[r * gridSize + c] = val;
          if (val < minElev) minElev = val;
          if (val > maxElev) maxElev = val;
        }
      }
    }

    const payload: TerrainMeshDataReadyMessage = {
      type: 'TERRAIN_MESH_DATA_READY',
      request_id: requestId,
      terrain_mode: terrainEngine.terrainMode,
      bounds,
      grid_size: gridSize,
      min_elevation_m: Number.isFinite(minElev) ? minElev : 0,
      max_elevation_m: Number.isFinite(maxElev) ? maxElev : 5000,
      elevations: transferGrid,
    };

    return {
      message: payload,
      transferList: [transferGrid.buffer],
    };
  }
}
