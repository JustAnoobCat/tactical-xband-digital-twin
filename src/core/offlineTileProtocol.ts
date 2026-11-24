/**
 * Tactical X-Band Digital Twin — Offline Air-Gap Tile Protocol & PMTiles v3 Header Parser
 *
 * Provides pure, stateless URL parsing for secure local air-gapped tile retrieval
 * and binary PMTiles v3 header validation.
 */

export interface OfflineTileRequest {
  readonly tileset: string;
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly ext: string;
  readonly relativePath: string;
}

export type ParseTileResult =
  | {
      readonly ok: true;
      readonly request: OfflineTileRequest;
      readonly tileset: string;
      readonly z: number;
      readonly x: number;
      readonly y: number;
      readonly ext: string;
      readonly relativePath: string;
    }
  | { readonly ok: false; readonly error: string };

const ALLOWED_EXTENSIONS = new Set<string>(['png', 'jpg', 'jpeg', 'webp', 'pbf', 'mvt']);
const TILESET_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates and parses an xband-tile:// request URL with strict defense against
 * directory traversal, encoded traversals, backslashes, null bytes, and out-of-bound zoom/coords.
 */
export function parseOfflineTileRequestUrl(rawUrl: string): ParseTileResult {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return { ok: false, error: 'Empty or non-string URL provided' };
  }

  // 1. Defense against directory traversal and evasion encodings
  const lowerRaw = rawUrl.toLowerCase();
  if (
    rawUrl.includes('..') ||
    lowerRaw.includes('%2e%2e') ||
    lowerRaw.includes('%2e') ||
    rawUrl.includes('\\') ||
    lowerRaw.includes('%5c') ||
    rawUrl.includes('\0') ||
    lowerRaw.includes('%00')
  ) {
    return { ok: false, error: 'Path traversal or invalid escape detected' };
  }

  // 2. Protocol validation
  if (!lowerRaw.startsWith('xband-tile:')) {
    return { ok: false, error: 'Invalid URL scheme: expected xband-tile:' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Malformed URL' };
  }

  if (parsed.search || parsed.hash) {
    return { ok: false, error: 'Query parameters and URL hashes are forbidden in offline tile requests' };
  }

  if (parsed.protocol !== 'xband-tile:') {
    return { ok: false, error: 'Invalid URL protocol' };
  }

  // Host represents the tileset name (e.g. "terrain", "satellite", "elevation")
  // Or in 3-slash notation (xband-tile:///tileset/z/x/y.ext), extract from the leading path segment
  let tileset = parsed.hostname || parsed.host;
  let pathname = parsed.pathname;

  if (!tileset) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 4) {
      tileset = segments[0];
      pathname = '/' + segments.slice(1).join('/');
    }
  }

  if (!tileset || !TILESET_NAME_REGEX.test(tileset)) {
    return { ok: false, error: `Invalid tileset identifier: "${tileset}"` };
  }

  // Path must be strictly /{z}/{x}/{y}.{ext}
  const match = pathname.match(/^\/([0-9]+)\/([0-9]+)\/([0-9]+)\.([a-zA-Z0-9]+)$/);
  if (!match) {
    return { ok: false, error: `Invalid tile path structure: "${pathname}". Expected /{z}/{x}/{y}.{ext}` };
  }

  const z = parseInt(match[1], 10);
  const x = parseInt(match[2], 10);
  const y = parseInt(match[3], 10);
  const ext = match[4].toLowerCase();

  // Validate zoom range: z in [0, 22]
  if (z < 0 || z > 22) {
    return { ok: false, error: `Zoom level out of range [0, 22]: z=${z}` };
  }

  // Coordinate range check: x, y in [0, 2^z - 1]
  const maxCoord = Math.pow(2, z);
  if (x < 0 || x >= maxCoord) {
    return { ok: false, error: `Tile coordinate X out of bounds for zoom ${z}: x=${x} (max=${maxCoord - 1})` };
  }
  if (y < 0 || y >= maxCoord) {
    return { ok: false, error: `Tile coordinate Y out of bounds for zoom ${z}: y=${y} (max=${maxCoord - 1})` };
  }

  // Extension validation
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `File extension "${ext}" not allowlisted for offline tiles` };
  }

  const relativePath = `${tileset}/${z}/${x}/${y}.${ext}`;

  const request: OfflineTileRequest = {
    tileset,
    z,
    x,
    y,
    ext,
    relativePath,
  };

  return {
    ok: true,
    request,
    tileset,
    z,
    x,
    y,
    ext,
    relativePath,
  };
}

export const MAX_OFFLINE_TILE_CHUNK_BYTES = 16 * 1024 * 1024;
export const MAX_OFFLINE_TILE_FILE_BYTES = 64 * 1024 * 1024;

export type ByteRangeParseResult =
  | { readonly ok: true; readonly start: number; readonly end: number; readonly chunkLength: number }
  | { readonly ok: false; readonly status: 413 | 416; readonly error: string };

/**
 * Parses an RFC 9110 single byte-range header against a known fileSize and enforces a strict
 * maximum chunk allocation cap (16 MB by default) so open-ended or oversized ranges cannot OOM.
 */
export function parseByteRangeHeader(
  rangeHeader: string,
  fileSize: number,
  maxChunkBytes: number = MAX_OFFLINE_TILE_CHUNK_BYTES
): ByteRangeParseResult {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=') || fileSize <= 0) {
    return { ok: false, status: 416, error: 'Invalid or unsatisfiable range' };
  }
  const parts = rangeHeader.slice(6).trim().split('-');
  if (parts.length !== 2) {
    return { ok: false, status: 416, error: 'Unsupported multi-range or malformed range header' };
  }
  const rawStart = parts[0].trim();
  const rawEnd = parts[1].trim();
  let start: number;
  let end: number;

  if (rawStart === '') {
    const suffixLength = parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { ok: false, status: 416, error: 'Invalid suffix byte range' };
    }
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = parseInt(rawStart, 10);
    if (!Number.isFinite(start) || start < 0 || start >= fileSize) {
      return { ok: false, status: 416, error: 'Range start out of bounds' };
    }
    if (rawEnd === '') {
      end = fileSize - 1;
    } else {
      end = parseInt(rawEnd, 10);
      if (!Number.isFinite(end) || end < start) {
        return { ok: false, status: 416, error: 'Range end out of bounds' };
      }
      if (end >= fileSize) end = fileSize - 1;
    }
  }

  const chunkLength = end - start + 1;
  if (chunkLength > maxChunkBytes) {
    return {
      ok: false,
      status: 413,
      error: `Requested byte range (${chunkLength} bytes) exceeds maximum chunk limit (${maxChunkBytes} bytes)`,
    };
  }

  return { ok: true, start, end, chunkLength };
}

export interface PmTilesV3Header {
  readonly specVersion: number;
  readonly rootDirectoryOffset: number;
  readonly rootDirectoryLength: number;
  readonly jsonMetadataOffset: number;
  readonly jsonMetadataLength: number;
  readonly leafDirectoryOffset: number;
  readonly leafDirectoryLength: number;
  readonly tileDataOffset: number;
  readonly tileDataLength: number;
  readonly addressedTilesCount: number;
  readonly tileEntriesCount: number;
  readonly tileContentsCount: number;
  readonly clustered: boolean;
  readonly internalCompression: string;
  readonly tileCompression: string;
  readonly tileType: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly minLonDeg: number;
  readonly minLatDeg: number;
  readonly maxLonDeg: number;
  readonly maxLatDeg: number;
  readonly centerZoom: number;
  readonly centerLonDeg: number;
  readonly centerLatDeg: number;
}

export type ParsePmTilesHeaderResult =
  | { readonly ok: true; readonly header: PmTilesV3Header }
  | { readonly ok: false; readonly error: string };

export const PMTILES_V3_CONSTANTS = {
  HEADER_SIZE_BYTES: 127,
  MAGIC: 'PMTiles',
  SPEC_VERSION: 3,
} as const;

export const PMTILES_V3_COMPRESSION_MAP: Readonly<Record<number, string>> = {
  0: 'unknown',
  1: 'none',
  2: 'gzip',
  3: 'brotli',
  4: 'zstd',
};

export const PMTILES_V3_TILE_TYPE_MAP: Readonly<Record<number, string>> = {
  0: 'unknown',
  1: 'mvt',
  2: 'png',
  3: 'jpeg',
  4: 'webp',
  5: 'avif',
};

const COMPRESSION_MAP = PMTILES_V3_COMPRESSION_MAP;
const TILE_TYPE_MAP = PMTILES_V3_TILE_TYPE_MAP;

/**
 * Parses the official 127-byte Protomaps PMTiles v3 binary header.
 * Little-endian format. Safely handles truncated or corrupted buffers.
 */
export function parsePmTilesV3Header(buffer: ArrayBuffer): ParsePmTilesHeaderResult {
  if (!buffer || !(buffer instanceof ArrayBuffer)) {
    return { ok: false, error: 'Invalid buffer: expected ArrayBuffer' };
  }

  if (buffer.byteLength < 127) {
    return { ok: false, error: `Buffer too small for PMTiles v3 header: ${buffer.byteLength} < 127 bytes` };
  }

  try {
    const view = new DataView(buffer);

    // Bytes 0-6: Magic "PMTiles" (7 bytes)
    const magicBytes = new Uint8Array(buffer, 0, 7);
    const magic = String.fromCharCode(...magicBytes);
    if (magic !== 'PMTiles') {
      return { ok: false, error: `Invalid PMTiles magic signature: "${magic}"` };
    }

    // Byte 7: Spec version (uint8)
    const specVersion = view.getUint8(7);
    if (specVersion !== 3) {
      return { ok: false, error: `Unsupported PMTiles spec version: ${specVersion} (expected 3)` };
    }

    // Offsets and lengths (BigUint64 Little-Endian)
    const rootDirectoryOffset = Number(view.getBigUint64(8, true));
    const rootDirectoryLength = Number(view.getBigUint64(16, true));
    const jsonMetadataOffset = Number(view.getBigUint64(24, true));
    const jsonMetadataLength = Number(view.getBigUint64(32, true));
    const leafDirectoryOffset = Number(view.getBigUint64(40, true));
    const leafDirectoryLength = Number(view.getBigUint64(48, true));
    const tileDataOffset = Number(view.getBigUint64(56, true));
    const tileDataLength = Number(view.getBigUint64(64, true));
    const addressedTilesCount = Number(view.getBigUint64(72, true));
    const tileEntriesCount = Number(view.getBigUint64(80, true));
    const tileContentsCount = Number(view.getBigUint64(88, true));

    // Flags & enums
    const clustered = view.getUint8(96) === 1;
    const internalCompressionCode = view.getUint8(97);
    const tileCompressionCode = view.getUint8(98);
    const tileTypeCode = view.getUint8(99);

    const internalCompression = COMPRESSION_MAP[internalCompressionCode] || 'unknown';
    const tileCompression = COMPRESSION_MAP[tileCompressionCode] || 'unknown';
    const tileType = TILE_TYPE_MAP[tileTypeCode] || 'unknown';

    // Zooms
    const minZoom = view.getUint8(100);
    const maxZoom = view.getUint8(101);

    // Geographic bounding box: 32-bit signed integer scaled by 1e-7
    const minLonDeg = view.getInt32(102, true) / 1e7;
    const minLatDeg = view.getInt32(106, true) / 1e7;
    const maxLonDeg = view.getInt32(110, true) / 1e7;
    const maxLatDeg = view.getInt32(114, true) / 1e7;

    // Center view
    const centerZoom = view.getUint8(118);
    const centerLonDeg = view.getInt32(119, true) / 1e7;
    const centerLatDeg = view.getInt32(123, true) / 1e7;

    return {
      ok: true,
      header: {
        specVersion,
        rootDirectoryOffset,
        rootDirectoryLength,
        jsonMetadataOffset,
        jsonMetadataLength,
        leafDirectoryOffset,
        leafDirectoryLength,
        tileDataOffset,
        tileDataLength,
        addressedTilesCount,
        tileEntriesCount,
        tileContentsCount,
        clustered,
        internalCompression,
        tileCompression,
        tileType,
        minZoom,
        maxZoom,
        minLonDeg,
        minLatDeg,
        maxLonDeg,
        maxLatDeg,
        centerZoom,
        centerLonDeg,
        centerLatDeg,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to parse PMTiles header: ${message}` };
  }
}
