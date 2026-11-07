/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Three.js 3D Subsystem — Terrain Geometry Builder (M6.2.2)
 *
 * Implements:
 * 1. Native 512x512 authentic DEM geometry (1:1 direct point registration, zero interpolation).
 * 2. Balanced 256x256 fallback geometry with continuous endpoint-preserving bilinear sampling.
 * 3. Perimeter skirts descending to the approved 1,700 m MSL datum foundation.
 * 4. Abstract tactical datum grid representing unmapped 1,200 km theater space without 0 m planes.
 */

import * as THREE from 'three';
import {
  TerrainGeometryBuildResult,
  TerrainMeshDataPayload,
  TerrainMeshResolution,
} from './threeTypes';
import { REAL_LADAKH_DEM_METADATA } from '../../core/terrain';

export const APPROVED_SKIRT_BASE_MSL_M = 1700.0;

/**
 * Continuous bilinear elevation interpolation on a source DEM raster.
 * Used for endpoint-preserving reduced resolution mapping.
 */
export function sampleDemBilinear(
  dem: Float32Array,
  u: number,
  v: number,
  width = 512,
  height = 512
): number {
  const c0 = Math.max(0, Math.min(width - 1, Math.floor(u)));
  const c1 = Math.max(0, Math.min(width - 1, c0 + 1));
  const fx = Math.max(0, Math.min(1, u - c0));

  const r0 = Math.max(0, Math.min(height - 1, Math.floor(v)));
  const r1 = Math.max(0, Math.min(height - 1, r0 + 1));
  const fy = Math.max(0, Math.min(1, v - r0));

  const z00 = dem[r0 * width + c0];
  const z01 = dem[r0 * width + c1];
  const z10 = dem[r1 * width + c0];
  const z11 = dem[r1 * width + c1];

  const zTop = (1.0 - fx) * z00 + fx * z01;
  const zBottom = (1.0 - fx) * z10 + fx * z11;

  return (1.0 - fy) * zTop + fy * zBottom;
}

/**
 * Builds the primary Native 512x512 DEM geometry.
 * Preserves every raw elevation point exactly (all 262,144 vertices) with zero interpolation error.
 * Uses Uint32Array index buffer.
 */
export function buildNativeDemGeometry(data: TerrainMeshDataPayload): THREE.BufferGeometry {
  const N = 512;
  const vertexCount = N * N; // 262,144
  const cellCount = (N - 1) * (N - 1); // 511 * 511 = 261,121
  const triangleCount = cellCount * 2; // 522,242
  const indexCount = triangleCount * 3; // 1,566,726

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);

  const minX = data.bounds.minX;
  const maxX = data.bounds.maxX;
  const minY = data.bounds.minY;
  const maxY = data.bounds.maxY;

  const xStep = (maxX - minX) / 511.0;
  const yStep = (maxY - minY) / 511.0;

  for (let r = 0; r < N; r++) {
    const yM = maxY - r * yStep; // Row 0 is North (+Y), Row 511 is South (-Y)
    const v = 1.0 - r / 511.0;

    for (let c = 0; c < N; c++) {
      const xM = minX + c * xStep; // Col 0 is West (-X), Col 511 is East (+X)
      const u = c / 511.0;
      const idx = r * N + c;

      positions[idx * 3] = xM;
      positions[idx * 3 + 1] = yM;
      positions[idx * 3 + 2] = data.elevations[idx];

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  // CCW Winding for upward (+Z) normals: [TL, BL, TR], [TR, BL, BR]
  let indexOffset = 0;
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const TL = r * N + c;
      const TR = r * N + (c + 1);
      const BL = (r + 1) * N + c;
      const BR = (r + 1) * N + (c + 1);

      // Triangle 1
      indices[indexOffset++] = TL;
      indices[indexOffset++] = BL;
      indices[indexOffset++] = TR;

      // Triangle 2
      indices[indexOffset++] = TR;
      indices[indexOffset++] = BL;
      indices[indexOffset++] = BR;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Builds the fallback Balanced 256x256 DEM geometry.
 * Maps endpoints exactly using continuous coordinates: sourceIndex = meshIndex * 511 / 255.
 * Uses Uint16Array index buffer (vertex count 65,536 <= 65,536).
 */
export function buildBalancedDemGeometry(data: TerrainMeshDataPayload): THREE.BufferGeometry {
  const N = 256;
  const vertexCount = N * N; // 65,536
  const cellCount = (N - 1) * (N - 1); // 255 * 255 = 65,025
  const triangleCount = cellCount * 2; // 130,050
  const indexCount = triangleCount * 3; // 390,150

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint16Array(indexCount);

  const minX = data.bounds.minX;
  const maxX = data.bounds.maxX;
  const minY = data.bounds.minY;
  const maxY = data.bounds.maxY;

  const xStep = (maxX - minX) / 255.0;
  const yStep = (maxY - minY) / 255.0;

  for (let r = 0; r < N; r++) {
    const yM = maxY - r * yStep;
    const srcRow = (r * 511.0) / 255.0; // exact mapping: 0 -> 0.0, 255 -> 511.0
    const v = 1.0 - r / 255.0;

    for (let c = 0; c < N; c++) {
      const xM = minX + c * xStep;
      const srcCol = (c * 511.0) / 255.0; // exact mapping: 0 -> 0.0, 255 -> 511.0
      const u = c / 255.0;
      const idx = r * N + c;

      const zM = sampleDemBilinear(data.elevations, srcCol, srcRow, 512, 512);

      positions[idx * 3] = xM;
      positions[idx * 3 + 1] = yM;
      positions[idx * 3 + 2] = zM;

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  let indexOffset = 0;
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const TL = r * N + c;
      const TR = r * N + (c + 1);
      const BL = (r + 1) * N + c;
      const BR = (r + 1) * N + (c + 1);

      indices[indexOffset++] = TL;
      indices[indexOffset++] = BL;
      indices[indexOffset++] = TR;

      indices[indexOffset++] = TR;
      indices[indexOffset++] = BL;
      indices[indexOffset++] = BR;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Builds 4 vertical perimeter skirts descending from terrain edges to the approved 1,700m datum.
 * Real DEM only; returns null for synthetic mode to avoid inappropriate skirt base clipping.
 */
export function buildPerimeterSkirtGeometry(
  data: TerrainMeshDataPayload,
  resolution: TerrainMeshResolution,
  skirtBaseMslM = APPROVED_SKIRT_BASE_MSL_M
): THREE.BufferGeometry | null {
  // In synthetic mode, omit skirts to prevent clipping uncalibrated procedural heights
  if (data.terrainMode === 'synthetic') {
    return null;
  }

  const N = resolution === 'native512' ? 512 : 256;
  const S = N - 1; // segments per edge

  const minX = data.bounds.minX;
  const maxX = data.bounds.maxX;
  const minY = data.bounds.minY;
  const maxY = data.bounds.maxY;

  const xStep = (maxX - minX) / S;
  const yStep = (maxY - minY) / S;

  // 4 walls × S quads per wall × 4 vertices per quad = 16 * S vertices
  const vertexCount = 16 * S;
  const triangleCount = 8 * S;
  const indexCount = triangleCount * 3;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint16Array(indexCount);

  let vOffset = 0;
  let iOffset = 0;

  const addQuad = (
    pBL: [number, number, number],
    pTL: [number, number, number],
    pTR: [number, number, number],
    pBR: [number, number, number],
    normal: [number, number, number]
  ) => {
    const baseIdx = vOffset;

    // BL (0)
    positions[vOffset * 3] = pBL[0];
    positions[vOffset * 3 + 1] = pBL[1];
    positions[vOffset * 3 + 2] = pBL[2];
    normals[vOffset * 3] = normal[0];
    normals[vOffset * 3 + 1] = normal[1];
    normals[vOffset * 3 + 2] = normal[2];
    vOffset++;

    // TL (1)
    positions[vOffset * 3] = pTL[0];
    positions[vOffset * 3 + 1] = pTL[1];
    positions[vOffset * 3 + 2] = pTL[2];
    normals[vOffset * 3] = normal[0];
    normals[vOffset * 3 + 1] = normal[1];
    normals[vOffset * 3 + 2] = normal[2];
    vOffset++;

    // TR (2)
    positions[vOffset * 3] = pTR[0];
    positions[vOffset * 3 + 1] = pTR[1];
    positions[vOffset * 3 + 2] = pTR[2];
    normals[vOffset * 3] = normal[0];
    normals[vOffset * 3 + 1] = normal[1];
    normals[vOffset * 3 + 2] = normal[2];
    vOffset++;

    // BR (3)
    positions[vOffset * 3] = pBR[0];
    positions[vOffset * 3 + 1] = pBR[1];
    positions[vOffset * 3 + 2] = pBR[2];
    normals[vOffset * 3] = normal[0];
    normals[vOffset * 3 + 1] = normal[1];
    normals[vOffset * 3 + 2] = normal[2];
    vOffset++;

    // Tri 1: BL, TL, TR
    indices[iOffset++] = baseIdx;
    indices[iOffset++] = baseIdx + 1;
    indices[iOffset++] = baseIdx + 2;

    // Tri 2: BL, TR, BR
    indices[iOffset++] = baseIdx;
    indices[iOffset++] = baseIdx + 2;
    indices[iOffset++] = baseIdx + 3;
  };

  const getElevation = (r: number, c: number): number => {
    if (resolution === 'native512') {
      return data.elevations[r * 512 + c];
    }
    const u = (c * 511.0) / 255.0;
    const v = (r * 511.0) / 255.0;
    return sampleDemBilinear(data.elevations, u, v, 512, 512);
  };

  // 1. North Wall (Row 0, Y = maxY, from West c=0 to East c=S). Normal: +Y
  for (let c = 0; c < S; c++) {
    const x0 = minX + c * xStep;
    const x1 = minX + (c + 1) * xStep;
    const z0 = getElevation(0, c);
    const z1 = getElevation(0, c + 1);

    addQuad(
      [x0, maxY, skirtBaseMslM],
      [x0, maxY, z0],
      [x1, maxY, z1],
      [x1, maxY, skirtBaseMslM],
      [0, 1, 0]
    );
  }

  // 2. South Wall (Row S, Y = minY, from West c=0 to East c=S). Normal: -Y
  for (let c = 0; c < S; c++) {
    const x0 = minX + c * xStep;
    const x1 = minX + (c + 1) * xStep;
    const z0 = getElevation(S, c);
    const z1 = getElevation(S, c + 1);

    // Invert winding for -Y normal: TR -> TL
    addQuad(
      [x1, minY, skirtBaseMslM],
      [x1, minY, z1],
      [x0, minY, z0],
      [x0, minY, skirtBaseMslM],
      [0, -1, 0]
    );
  }

  // 3. East Wall (Col S, X = maxX, from North r=0 to South r=S). Normal: +X
  for (let r = 0; r < S; r++) {
    const y0 = maxY - r * yStep;
    const y1 = maxY - (r + 1) * yStep;
    const z0 = getElevation(r, S);
    const z1 = getElevation(r + 1, S);

    addQuad(
      [maxX, y0, skirtBaseMslM],
      [maxX, y0, z0],
      [maxX, y1, z1],
      [maxX, y1, skirtBaseMslM],
      [1, 0, 0]
    );
  }

  // 4. West Wall (Col 0, X = minX, from North r=0 to South r=S). Normal: -X
  for (let r = 0; r < S; r++) {
    const y0 = maxY - r * yStep;
    const y1 = maxY - (r + 1) * yStep;
    const z0 = getElevation(r, 0);
    const z1 = getElevation(r + 1, 0);

    // Invert winding for -X normal: TR -> TL
    addQuad(
      [minX, y1, skirtBaseMslM],
      [minX, y1, z1],
      [minX, y0, z0],
      [minX, y0, skirtBaseMslM],
      [-1, 0, 0]
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}

/**
 * Builds the abstract tactical datum grid and range rings covering the 1,200 km theater.
 * Strictly wireframe lines at datum level 1,700 m MSL. Never a flat 0m terrain plane.
 */
export function buildTacticalDatumGrid(
  datumZ = APPROVED_SKIRT_BASE_MSL_M,
  theaterRadiusM = 600000.0,
  demBounds?: { minX: number; maxX: number; minY: number; maxY: number }
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'tacticalDatumGrid';

  // 1. Concentric range rings
  const ringRadii = [50000, 100000, 200000, 300000, 500000, theaterRadiusM];
  const ringSegments = 128;
  const ringMaterial = new THREE.LineBasicMaterial({
    color: 0x1e293b,
    transparent: true,
    opacity: 0.6,
  });

  ringRadii.forEach(r => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= ringSegments; i++) {
      const theta = (i / ringSegments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(theta) * r, Math.sin(theta) * r, datumZ));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geom, ringMaterial);
    line.name = `rangeRing_${Math.round(r / 1000)}km`;
    group.add(line);
  });

  // 2. Cardinal axes crosshairs across 1,200 km theater
  const crossMaterial = new THREE.LineBasicMaterial({
    color: 0x1e293b,
    transparent: true,
    opacity: 0.5,
  });
  const crossPoints = [
    new THREE.Vector3(-theaterRadiusM, 0, datumZ),
    new THREE.Vector3(theaterRadiusM, 0, datumZ),
    new THREE.Vector3(0, -theaterRadiusM, datumZ),
    new THREE.Vector3(0, theaterRadiusM, datumZ),
  ];
  const crossGeom = new THREE.BufferGeometry().setFromPoints(crossPoints);
  const crossLines = new THREE.LineSegments(crossGeom, crossMaterial);
  crossLines.name = 'theaterCardinalCrosshairs';
  group.add(crossLines);

  // 3. DEM Footprint Boundary Outline at datum level
  const b = demBounds || {
    minX: -REAL_LADAKH_DEM_METADATA.halfWidthM,
    maxX: REAL_LADAKH_DEM_METADATA.halfWidthM,
    minY: -REAL_LADAKH_DEM_METADATA.halfHeightM,
    maxY: REAL_LADAKH_DEM_METADATA.halfHeightM,
  };
  const boundaryPoints = [
    new THREE.Vector3(b.minX, b.minY, datumZ),
    new THREE.Vector3(b.maxX, b.minY, datumZ),
    new THREE.Vector3(b.maxX, b.maxY, datumZ),
    new THREE.Vector3(b.minX, b.maxY, datumZ),
    new THREE.Vector3(b.minX, b.minY, datumZ),
  ];
  const boundaryGeom = new THREE.BufferGeometry().setFromPoints(boundaryPoints);
  const boundaryMaterial = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    linewidth: 1.5,
    transparent: true,
    opacity: 0.8,
  });
  const boundaryLine = new THREE.Line(boundaryGeom, boundaryMaterial);
  boundaryLine.name = 'demBoundaryDatumOutline';
  group.add(boundaryLine);

  return group;
}

/**
 * Builds the complete terrain and skirt geometry set based on resolution
 */
export function buildTerrainGeometrySet(
  data: TerrainMeshDataPayload,
  resolution: TerrainMeshResolution = 'native512'
): TerrainGeometryBuildResult {
  const meshGeometry =
    resolution === 'native512'
      ? buildNativeDemGeometry(data)
      : buildBalancedDemGeometry(data);

  const skirtGeometry = buildPerimeterSkirtGeometry(data, resolution, APPROVED_SKIRT_BASE_MSL_M);

  const vertexCount = meshGeometry.getAttribute('position').count;
  const triangleCount = meshGeometry.getIndex() ? meshGeometry.getIndex()!.count / 3 : 0;

  return {
    meshGeometry,
    skirtGeometry,
    resolution,
    vertexCount,
    triangleCount,
    minElevationM: data.minElevationM,
    maxElevationM: data.maxElevationM,
  };
}

