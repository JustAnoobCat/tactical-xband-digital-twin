/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Simulation Timeline Decoupled Dual-File CSV Exporter (DRDO-TAC-XBAND-ARCH-TIMELINE-17)
 *
 * Implements Feature F (SPEC-TIMELINE-ENHANCE-01-REV10):
 * - File 1: tactical_spatial_frames_[t0]s_to_[t1]s.csv (Kinematics, restored gas/rain loss, 128 nodes)
 * - File 2: tactical_comm_epochs_[t0]s_to_[t1]s.csv (Epochs, queue metrics, drops, delivery ratios, discontinuities)
 * - Chunked string assembly to keep transient V8 heap and native allocations strictly <= 45.0 MB.
 * - Sequential browser download dispatch with 350 ms spacing and 60 s URL revocation.
 * - Persistent modal fallback buttons for resilient download recovery.
 */

import type { ReadonlySpatialExportColumns, SpatialSnapshotBuffer } from './spatialSnapshotBuffer';
import type { EvictionHistoryMetadata, SuperframeEpochStore } from './superframeEpochStore';
import type {
  SuperframeEpochRecord,
  SuperframeDiscontinuityRecord,
  EvictionDropFinalizationRecord,
} from '../shared/workerProtocol';

const EMPTY_CSV_EVICTION_METADATA: EvictionHistoryMetadata = {
  evictionCapacity: 0,
  retainedCount: 0,
  totalEvictionRecordsSeen: 0,
  discardedEvictionCount: 0,
  evictedByCapacityCount: 0,
  evictedByHorizonCount: 0,
  hasEvictedFinalizationHistory: false,
  oldestRetainedTimestampS: null,
  newestRetainedTimestampS: null,
  oldestRetainedFrameIndex: null,
  newestRetainedFrameIndex: null,
  minDiscardedTimestampS: null,
  maxDiscardedTimestampS: null,
  minDiscardedFrameIndex: null,
  maxDiscardedFrameIndex: null,
  minRetainedFinalizationIndex: null,
  maxRetainedFinalizationIndex: null,
  evictionFloorIndex: 0,
};

/**
 * Formats an exact floating-point timestamp for CSV export without rounding truncation.
 */
export function formatExactCsvTimestamp(timestampS: number): string {
  if (!Number.isFinite(timestampS)) return '';
  return timestampS === 0 ? '0' : String(timestampS);
}

export interface SpatialCsvOptions {
  readonly timeRangeS?: readonly [number, number];
  readonly maxNodes?: number;
  readonly include128Nodes?: boolean;
}

export interface CommCsvOptions {
  readonly timeRangeS?: readonly [number, number];
}

export interface DualExportOptions {
  readonly spatialBuffer: SpatialSnapshotBuffer;
  readonly epochStore: SuperframeEpochStore;
  readonly timeRangeS?: readonly [number, number];
  readonly maxNodes?: number;
  readonly include128Nodes?: boolean;
  readonly autoDispatch?: boolean;
  readonly downloadDispatcher?: (blob: Blob, filename: string) => void;
}

export interface DualExportResult {
  readonly spatialFilename: string;
  readonly commFilename: string;
  readonly spatialBlob: Blob;
  readonly commBlob: Blob;
  readonly spatialBytes: number;
  readonly commBytes: number;
  readonly downloadSpatial: () => void;
  readonly downloadComm: () => void;
  readonly dispatchedCount: number;
  readonly commSelectedIntervalEvictionMayBeTruncated: boolean;
  readonly selectedIntervalEvictionMayBeTruncated: boolean;
  readonly selectedIntervalTruncationNotice: string | null;
  readonly globalDiscardedEvictionCount: number;
  readonly globalEvictionMinWatermarkTimestampS: number | null;
  readonly globalEvictionWatermarkTimestampS: number | null;
  readonly evictionHistoryMetadata: EvictionHistoryMetadata;
}

const CHUNK_ROW_COUNT = 250;

/**
 * Dispatches a browser file download with 60-second Blob URL cleanup.
 */
export function defaultDownloadDispatcher(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke Blob URL after 60 seconds
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignored if already revoked
    }
  }, 60000);
}

const POW10 = [1, 10, 100, 1000, 10000] as const;

/**
 * Zero-string-allocation streaming UTF-8 byte buffer builder for CSV exports.
 */
class CsvByteWriter {
  private readonly encoder = new TextEncoder();
  private buf: Uint8Array;
  private pos: number = 0;
  private readonly chunks: BlobPart[] = [];
  private readonly strCache = new Map<string, Uint8Array>();

  constructor(initialSize: number = 65536) {
    this.buf = new Uint8Array(initialSize);
  }

  private ensure(needed: number): void {
    if (this.pos + needed <= this.buf.length) return;
    let nextLen = this.buf.length * 2;
    while (nextLen < this.pos + needed) nextLen *= 2;
    const grown = new Uint8Array(nextLen);
    grown.set(this.buf.subarray(0, this.pos), 0);
    this.buf = grown;
  }

  public comma(): void {
    this.ensure(1);
    this.buf[this.pos++] = 44;
  }

  public newline(): void {
    this.ensure(1);
    this.buf[this.pos++] = 10;
    if (this.pos >= 32768) {
      this.chunks.push(this.buf.slice(0, this.pos) as BlobPart);
      this.pos = 0;
    }
  }

  public writeRaw(text: string): void {
    this.ensure(text.length * 3 + 4);
    const res = this.encoder.encodeInto(text, this.buf.subarray(this.pos));
    this.pos += res.written;
  }

  public writeCached(text: string): void {
    let bytes = this.strCache.get(text);
    if (!bytes) {
      bytes = this.encoder.encode(text);
      if (this.strCache.size < 512) {
        this.strCache.set(text, bytes);
      }
    }
    this.ensure(bytes.length + 1);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  public writeInt(value: number): void {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e12) {
      this.writeRaw(String(value));
      return;
    }
    const n = Math.trunc(value);
    if (n === 0) {
      this.ensure(1);
      this.buf[this.pos++] = 48;
      return;
    }
    this.ensure(24);
    let rem = n;
    if (rem < 0) {
      this.buf[this.pos++] = 45;
      rem = -rem;
    }
    const start = this.pos;
    while (rem > 0) {
      const q = Math.floor(rem / 10);
      this.buf[this.pos++] = 48 + (rem - q * 10);
      rem = q;
    }
    let lo = start;
    let hi = this.pos - 1;
    while (lo < hi) {
      const tmp = this.buf[lo];
      this.buf[lo++] = this.buf[hi];
      this.buf[hi--] = tmp;
    }
  }

  public writeFixed(value: number, decimals: 1 | 2 | 3 | 4): void {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e9) {
      this.writeRaw(value.toFixed(decimals));
      return;
    }
    const mult = POW10[decimals];
    const scaled = Math.round(Math.abs(value) * mult);
    this.ensure(24);
    if (value < 0 && scaled > 0) {
      this.buf[this.pos++] = 45;
    }
    const intPart = Math.floor(scaled / mult);
    let frac = scaled - intPart * mult;
    if (intPart === 0) {
      this.buf[this.pos++] = 48;
    } else {
      const start = this.pos;
      let rem = intPart;
      while (rem > 0) {
        const q = Math.floor(rem / 10);
        this.buf[this.pos++] = 48 + (rem - q * 10);
        rem = q;
      }
      let lo = start;
      let hi = this.pos - 1;
      while (lo < hi) {
        const tmp = this.buf[lo];
        this.buf[lo++] = this.buf[hi];
        this.buf[hi--] = tmp;
      }
    }
    this.buf[this.pos++] = 46; // '.'
    for (let d = decimals - 1; d >= 0; d--) {
      const div = POW10[d];
      const digit = Math.floor(frac / div);
      this.buf[this.pos++] = 48 + digit;
      frac -= digit * div;
    }
  }

  public toBlob(): Blob {
    if (this.pos > 0) {
      this.chunks.push(this.buf.slice(0, this.pos) as BlobPart);
      this.pos = 0;
    }
    const blob = new Blob(this.chunks, { type: 'text/csv;charset=utf-8;' });
    this.chunks.length = 0;
    this.strCache.clear();
    this.buf = new Uint8Array(0);
    return blob;
  }
}

/**
 * Generates File 1: Spatial Frame Kinematics CSV.
 */
export function generateSpatialFramesCsv(
  spatialBuffer: SpatialSnapshotBuffer,
  options: SpatialCsvOptions = {}
): { filename: string; blob: Blob; rowCount: number; byteLength: number } {
  const count = spatialBuffer.count;
  const t0 = count > 0 ? spatialBuffer.oldestSimulationTimeS : 0.0;
  const t1 = count > 0 ? spatialBuffer.newestSimulationTimeS : 0.0;
  const filename = `tactical_spatial_frames_${t0.toFixed(2)}s_to_${t1.toFixed(2)}s.csv`;

  const includeNodes = options.include128Nodes ?? false;
  const nodeCount = includeNodes ? (options.maxNodes ?? 128) : (options.maxNodes ?? 0);

  const baseHeader = [
    'frame_index',
    'sim_time_s',
    'wall_clock_time_ms',
    'acn_pos_x_m',
    'acn_pos_y_m',
    'acn_pos_z_m',
    'acn_vel_x_mps',
    'acn_vel_y_mps',
    'acn_vel_z_mps',
    'acn_heading_rad',
    'acn_pitch_deg',
    'acn_altitude_msl_m',
    'acn_altitude_agl_m',
    'acn_coverage_radius_km',
    'acn_is_terrain_clamped',
    'selected_node_id',
    'sel_slant_range_km',
    'sel_fspl_db',
    'sel_diffraction_loss_db',
    'sel_gas_loss_db',
    'sel_rain_loss_db',
    'sel_total_loss_db',
    'sel_snr_db',
    'sel_bitrate_mbps',
    'sel_modcod',
    'sel_is_outage',
    'active_nodes_count',
  ];

  if (nodeCount > 0) {
    for (let nid = 0; nid < nodeCount; nid++) {
      baseHeader.push(
        `node_${nid}_snr_db`,
        `node_${nid}_is_los`,
        `node_${nid}_is_outage`,
        `node_${nid}_state`
      );
    }
  }

  const writer = new CsvByteWriter(65536);
  writer.writeRaw(baseHeader.join(','));
  writer.newline();

  let totalRows = 0;
  const [filterT0, filterT1] = options.timeRangeS ?? [-Infinity, Infinity];

  const hasReadonlyCols = typeof (spatialBuffer as unknown as {
    getReadonlyExportColumns?: () => ReadonlySpatialExportColumns;
  }).getReadonlyExportColumns === 'function';

  if (hasReadonlyCols) {
    const cols = (spatialBuffer as unknown as {
      getReadonlyExportColumns: () => ReadonlySpatialExportColumns;
    }).getReadonlyExportColumns();
    const slotPresent = nodeCount > 0 ? new Uint8Array(nodeCount) : null;
    const slotSnr = nodeCount > 0 ? new Float64Array(nodeCount) : null;
    const slotFlags = nodeCount > 0 ? new Uint8Array(nodeCount) : null;

    for (let i = 0; i < cols.count; i++) {
      const phys = cols.count < cols.capacity ? i : (cols.writeIndex + i) % cols.capacity;
      const simTimeS = cols.simulationTimeS[phys];
      if (simTimeS < filterT0 || simTimeS > filterT1) continue;

      writer.writeInt(cols.frameIndices[phys]); writer.comma();
      writer.writeFixed(simTimeS, 4); writer.comma();
      writer.writeFixed(cols.wallClockTimeMs[phys], 1); writer.comma();
      writer.writeFixed(cols.acnPosX[phys], 2); writer.comma();
      writer.writeFixed(cols.acnPosY[phys], 2); writer.comma();
      writer.writeFixed(cols.acnPosZ[phys], 2); writer.comma();
      writer.writeFixed(cols.acnVelX[phys], 2); writer.comma();
      writer.writeFixed(cols.acnVelY[phys], 2); writer.comma();
      writer.writeFixed(cols.acnVelZ[phys], 2); writer.comma();
      writer.writeFixed(cols.acnHeadingRad[phys], 4); writer.comma();
      writer.writeFixed(cols.acnPitchDeg[phys], 2); writer.comma();
      if (!Number.isNaN(cols.acnAltitudeMslM[phys])) writer.writeFixed(cols.acnAltitudeMslM[phys], 2);
      writer.comma();
      if (!Number.isNaN(cols.acnAltitudeAglM[phys])) writer.writeFixed(cols.acnAltitudeAglM[phys], 2);
      writer.comma();
      writer.writeFixed(cols.acnCoverageRadiusKm[phys], 2); writer.comma();
      writer.writeInt(cols.acnIsTerrainClamped[phys] === 1 ? 1 : 0); writer.comma();

      if (cols.hasSelectedLinkBudget[phys] === 1) {
        const slantKm = (cols.selSlantRangeKm[phys] * 1000.0) / 1000.0;
        writer.writeInt(cols.selNodeId[phys]); writer.comma();
        writer.writeFixed(slantKm, 3); writer.comma();
        writer.writeFixed(cols.selFsplDb[phys], 2); writer.comma();
        writer.writeFixed(cols.selDiffractionLossDb[phys], 2); writer.comma();
        writer.writeFixed(cols.selGasLossDb[phys] ?? 0.0, 4); writer.comma();
        writer.writeFixed(cols.selRainLossDb[phys] ?? 0.0, 4); writer.comma();
        writer.writeFixed(cols.selTotalLossDb[phys], 2); writer.comma();
        writer.writeFixed(cols.selSnrDb[phys], 2); writer.comma();
        writer.writeFixed(cols.selBitrateMbps[phys], 2); writer.comma();
        writer.writeCached(cols.getModcodName(cols.selModcodCode[phys])); writer.comma();
        writer.writeInt(cols.selIsOutage[phys] === 1 ? 1 : 0); writer.comma();
      } else {
        writer.writeRaw(',,,,,,,,,,,');
      }

      const numNodes = cols.nodeCounts[phys];
      writer.writeInt(numNodes);

      if (nodeCount > 0 && slotPresent && slotSnr && slotFlags) {
        const baseSlot = phys * cols.maxActiveGroundNodes;
        let denseOrdered = numNodes >= nodeCount;
        if (denseOrdered) {
          for (let j = 0; j < nodeCount; j++) {
            if (cols.nodeIds[baseSlot + j] !== j) {
              denseOrdered = false;
              break;
            }
          }
        }
        if (denseOrdered) {
          for (let nid = 0; nid < nodeCount; nid++) {
            const slot = baseSlot + nid;
            const flags = cols.nodeFlags[slot];
            writer.comma();
            writer.writeFixed(cols.nodeSnrDb[slot] / 100.0, 2);
            writer.comma();
            writer.writeInt((flags & 1) !== 0 ? 1 : 0);
            writer.comma();
            writer.writeInt((flags & 2) !== 0 ? 1 : 0);
            writer.comma();
            writer.writeCached(cols.getStateName((flags >> 3) & 7));
          }
        } else {
          slotPresent.fill(0);
          for (let j = 0; j < numNodes; j++) {
            const slot = baseSlot + j;
            const nid = cols.nodeIds[slot];
            if (nid < nodeCount) {
              slotPresent[nid] = 1;
              slotSnr[nid] = cols.nodeSnrDb[slot] / 100.0;
              slotFlags[nid] = cols.nodeFlags[slot];
            }
          }
          for (let nid = 0; nid < nodeCount; nid++) {
            if (slotPresent[nid] === 1) {
              const flags = slotFlags[nid];
              writer.comma();
              writer.writeFixed(slotSnr[nid], 2);
              writer.comma();
              writer.writeInt((flags & 1) !== 0 ? 1 : 0);
              writer.comma();
              writer.writeInt((flags & 2) !== 0 ? 1 : 0);
              writer.comma();
              writer.writeCached(cols.getStateName((flags >> 3) & 7));
            } else {
              writer.writeRaw(',,,,');
            }
          }
        }
      }

      writer.newline();
      totalRows++;
    }
  } else {
    const nodeMap = new Map<number, any>();
    for (let i = 0; i < count; i++) {
      const snap = spatialBuffer.get(i);
      if (!snap) continue;
      if (snap.simulationTimeS < filterT0 || snap.simulationTimeS > filterT1) continue;

      writer.writeInt(snap.frameIndex); writer.comma();
      writer.writeFixed(snap.simulationTimeS, 4); writer.comma();
      writer.writeFixed(snap.wallClockTimeMs, 1); writer.comma();
      writer.writeFixed(snap.acn.posX, 2); writer.comma();
      writer.writeFixed(snap.acn.posY, 2); writer.comma();
      writer.writeFixed(snap.acn.posZ, 2); writer.comma();
      writer.writeFixed(snap.acn.velX, 2); writer.comma();
      writer.writeFixed(snap.acn.velY, 2); writer.comma();
      writer.writeFixed(snap.acn.velZ, 2); writer.comma();
      writer.writeFixed(snap.acn.headingRad, 4); writer.comma();
      writer.writeFixed(snap.acn.pitchDeg, 2); writer.comma();
      if (snap.acn.altitudeMslM != null) writer.writeFixed(snap.acn.altitudeMslM, 2);
      writer.comma();
      if (snap.acn.altitudeAglM != null) writer.writeFixed(snap.acn.altitudeAglM, 2);
      writer.comma();
      writer.writeFixed(snap.acn.coverageRadiusKm, 2); writer.comma();
      writer.writeInt(snap.acn.isTerrainClamped ? 1 : 0); writer.comma();

      const lb = snap.selectedLinkBudget;
      if (lb) {
        writer.writeInt((snap as any).selectedNodeId ?? -1); writer.comma();
        writer.writeFixed(lb.slantRangeM / 1000.0, 3); writer.comma();
        writer.writeFixed(lb.fsplDb, 2); writer.comma();
        writer.writeFixed(lb.diffractionLossDb, 2); writer.comma();
        writer.writeFixed(lb.gasLossDb ?? 0.0, 4); writer.comma();
        writer.writeFixed(lb.rainLossDb ?? 0.0, 4); writer.comma();
        writer.writeFixed(lb.totalLossDb, 2); writer.comma();
        writer.writeFixed(lb.snrDb, 2); writer.comma();
        writer.writeFixed(lb.bitrateMbps, 2); writer.comma();
        writer.writeCached(lb.modcodName); writer.comma();
        writer.writeInt(lb.isOutage ? 1 : 0); writer.comma();
      } else {
        writer.writeRaw(',,,,,,,,,,,');
      }
      writer.writeInt(snap.nodes.length);

      if (nodeCount > 0) {
        const nodes = snap.nodes;
        let denseOrdered = nodes.length >= nodeCount;
        if (denseOrdered) {
          for (let j = 0; j < nodeCount; j++) {
            if (nodes[j].nodeId !== j) {
              denseOrdered = false;
              break;
            }
          }
        }
        if (!denseOrdered) {
          nodeMap.clear();
          for (let j = 0; j < nodes.length; j++) {
            nodeMap.set(nodes[j].nodeId, nodes[j]);
          }
        }
        for (let nid = 0; nid < nodeCount; nid++) {
          const n = denseOrdered ? nodes[nid] : nodeMap.get(nid);
          if (n) {
            writer.comma();
            writer.writeFixed(n.snrDb, 2);
            writer.comma();
            writer.writeInt(n.isLos ? 1 : 0);
            writer.comma();
            writer.writeInt(n.isOutage ? 1 : 0);
            writer.comma();
            writer.writeCached(String(n.currentState));
          } else {
            writer.writeRaw(',,,,');
          }
        }
      }

      writer.newline();
      totalRows++;
    }
    nodeMap.clear();
  }

  const blob = writer.toBlob();
  return {
    filename,
    blob,
    rowCount: totalRows,
    byteLength: blob.size,
  };
}

function writeSchedulerEpochMetricsCols(
  writer: CsvByteWriter,
  m: SuperframeEpochRecord['staticMetrics'],
  durationS: number
): void {
  const goodputBps = durationS > 0 ? Math.round(m.transmittedNonOutageBits / durationS) : 0;
  writer.writeInt(m.transmittedNonOutageBits); writer.comma();
  writer.writeInt(m.outageWastedBits); writer.comma();
  writer.writeInt(m.totalPayloadBitsDequeued); writer.comma();
  writer.writeInt(m.droppedDelayPkts); writer.comma();
  writer.writeInt(m.droppedOverflowPkts); writer.comma();
  writer.writeInt(m.totalDroppedPkts); writer.comma();
  writer.writeInt(m.totalDroppedBytes ?? (m.totalDroppedPkts * 1500)); writer.comma();
  writer.writeFixed(m.ulUtilizationPct, 2); writer.comma();
  writer.writeInt(goodputBps); writer.comma();
  if (m.totalPayloadBitsDequeued > 0) {
    writer.writeFixed((m.transmittedNonOutageBits / m.totalPayloadBitsDequeued) * 100, 2);
  }
  writer.comma();
  if (m.endQueueDepthPkts != null) writer.writeInt(m.endQueueDepthPkts);
  writer.comma();
  if (m.endBacklogBytes != null) writer.writeInt(m.endBacklogBytes);
  writer.comma();
  if (m.meanHeadOfLineSojournMs != null) writer.writeFixed(m.meanHeadOfLineSojournMs, 3);
}

function writeIntervalRecordRow(
  writer: CsvByteWriter,
  rec: SuperframeEpochRecord | SuperframeDiscontinuityRecord,
  fallbackIndex: number
): void {
  if (rec.recordType === 'EPOCH') {
    const ep = rec as SuperframeEpochRecord;
    const durationS = ep.durationMs / 1000.0;
    writer.writeRaw('EPOCH,');
    writer.writeInt(ep.epochIndex ?? fallbackIndex); writer.comma();
    writer.writeFixed(ep.startTimeS, 4); writer.comma();
    writer.writeFixed(ep.endTimeS, 4); writer.comma();
    writer.writeFixed(ep.durationMs, 2); writer.comma();
    const covered0 = ep.coveredFrameRange ? ep.coveredFrameRange[0] : ep.associatedSimulationFrameIndex;
    const covered1 = ep.coveredFrameRange ? ep.coveredFrameRange[1] : undefined;
    if (covered0 != null) writer.writeInt(covered0);
    writer.comma();
    if (covered1 != null) writer.writeInt(covered1);
    writer.comma();
    writer.writeCached(ep.activeSchedulerMode ?? 'tac_tad'); writer.comma();
    writeSchedulerEpochMetricsCols(writer, ep.staticMetrics, durationS);
    writer.comma();
    writeSchedulerEpochMetricsCols(writer, ep.tacMetrics, durationS);
    writer.writeRaw(',,,,,,,,'); // Columns 34..41 empty for EPOCH
    writer.newline();
    return;
  }

  const dis = rec as SuperframeDiscontinuityRecord;
  writer.writeRaw('DISCONTINUITY,');
  writer.writeInt(dis.discontinuityIndex ?? fallbackIndex); writer.comma();
  writer.writeFixed(dis.startTimeS, 4); writer.comma();
  writer.writeFixed(dis.endTimeS, 4); writer.comma();
  writer.writeFixed(dis.discardedDurationMs, 2);
  writer.writeRaw(','.repeat(30));
  writer.writeCached(dis.reconfigurationReason ?? dis.reason ?? 'RECONFIGURATION_RESET');
  writer.comma();
  writer.writeFixed(dis.discardedDurationMs, 2);
  writer.writeRaw(',,,,,,');
  writer.newline();
}

function writeEvictionRecordRow(writer: CsvByteWriter, ev: EvictionDropFinalizationRecord): void {
  const exactTs = formatExactCsvTimestamp(ev.timestampS);
  const isStatic = ev.schedulerId === 'STATIC_TDMA';
  writer.writeRaw('NODE_EVICTION_FINALIZATION,');
  writer.writeInt(ev.finalizationIndex);
  writer.comma();
  writer.writeRaw(exactTs); writer.comma();
  writer.writeRaw(exactTs); writer.writeRaw(',0,');
  writer.writeInt(ev.associatedSimulationFrameIndex); writer.comma();
  writer.writeInt(ev.associatedSimulationFrameIndex); writer.writeRaw(',,'); // 7: active_scheduler_mode empty
  // 8..20: static_*
  writer.writeRaw(',,,');
  if (isStatic) {
    writer.writeInt(ev.droppedDelayPkts); writer.comma();
    writer.writeInt(ev.droppedOverflowPkts); writer.comma();
    writer.writeInt(ev.totalDroppedPkts); writer.comma();
    writer.writeInt(ev.totalDroppedBytes);
    writer.writeRaw(',,,,,,');
  } else {
    writer.writeRaw(',,,,,,,,,');
  }
  writer.comma();
  // 21..33: tac_*
  writer.writeRaw(',,,');
  if (!isStatic) {
    writer.writeInt(ev.droppedDelayPkts); writer.comma();
    writer.writeInt(ev.droppedOverflowPkts); writer.comma();
    writer.writeInt(ev.totalDroppedPkts); writer.comma();
    writer.writeInt(ev.totalDroppedBytes);
    writer.writeRaw(',,,,,,');
  } else {
    writer.writeRaw(',,,,,,,,,');
  }
  // 34..35: discontinuity fields empty
  writer.writeRaw(',,,');
  // 36..41: REV15 eviction scheduler, node, and scheduler-scoped delay/overflow byte totals
  writer.writeCached(ev.schedulerId); writer.comma();
  writer.writeInt(ev.nodeId); writer.comma();
  if (isStatic) {
    writer.writeInt(ev.droppedDelayBytes); writer.comma();
    writer.writeInt(ev.droppedOverflowBytes);
    writer.writeRaw(',,');
  } else {
    writer.writeRaw(',,');
    writer.writeInt(ev.droppedDelayBytes); writer.comma();
    writer.writeInt(ev.droppedOverflowBytes);
  }
  writer.newline();
}

/**
 * Generates File 2: Communication Epochs & Eviction Finalizations CSV.
 */
export function generateCommEpochsCsv(
  epochStore: SuperframeEpochStore,
  options: CommCsvOptions = {}
): {
  filename: string;
  blob: Blob;
  rowCount: number;
  byteLength: number;
  selectedIntervalEvictionMayBeTruncated: boolean;
  selectedIntervalTruncationNotice: string | null;
  globalDiscardedEvictionCount: number;
  discardedEvictionCount: number;
  globalEvictionMinWatermarkTimestampS: number | null;
  globalEvictionWatermarkTimestampS: number | null;
  evictionWatermarkTimestampS: number | null;
  evictionHistoryMetadata: EvictionHistoryMetadata;
} {
  const count = epochStore.count;
  const [filterT0, filterT1] = options.timeRangeS ?? [-Infinity, Infinity];
  const filteredEvictions =
    typeof epochStore.getEvictionFinalizationsInWindow === 'function'
      ? epochStore.getEvictionFinalizationsInWindow(filterT0, filterT1, true)
      : [];

  let t0 = count > 0 ? (epochStore.oldestRecord?.startTimeS ?? 0.0) : 0.0;
  let t1 = count > 0 ? (epochStore.newestRecord?.endTimeS ?? 0.0) : 0.0;
  if (count === 0 && filteredEvictions.length > 0) {
    t0 = filteredEvictions[0].timestampS;
    t1 = filteredEvictions[filteredEvictions.length - 1].timestampS;
  } else if (filteredEvictions.length > 0) {
    t0 = Math.min(t0, filteredEvictions[0].timestampS);
    t1 = Math.max(t1, filteredEvictions[filteredEvictions.length - 1].timestampS);
  }
  const filename = `tactical_comm_epochs_${t0.toFixed(2)}s_to_${t1.toFixed(2)}s.csv`;

  const header = [
    'record_type',
    'epoch_index',
    'start_time_s',
    'end_time_s',
    'duration_ms',
    'associated_frame_start',
    'associated_frame_end',
    'active_scheduler_mode',
    'static_tx_non_outage_bits',
    'static_outage_wasted_bits',
    'static_total_payload_dequeued_bits',
    'static_dropped_delay_pkts',
    'static_dropped_overflow_pkts',
    'static_total_dropped_pkts',
    'static_cumulative_dropped_bytes',
    'static_ul_util_pct',
    'static_goodput_bps',
    'static_dequeued_payload_delivery_ratio_pct',
    'static_end_queue_depth_pkts',
    'static_end_backlog_bytes',
    'static_mean_hol_sojourn_ms',
    'tac_tx_non_outage_bits',
    'tac_outage_wasted_bits',
    'tac_total_payload_dequeued_bits',
    'tac_dropped_delay_pkts',
    'tac_dropped_overflow_pkts',
    'tac_total_dropped_pkts',
    'tac_cumulative_dropped_bytes',
    'tac_ul_util_pct',
    'tac_goodput_bps',
    'tac_dequeued_payload_delivery_ratio_pct',
    'tac_end_queue_depth_pkts',
    'tac_end_backlog_bytes',
    'tac_mean_hol_sojourn_ms',
    'discontinuity_reason',
    'discarded_duration_ms',
    'eviction_scheduler_id',
    'eviction_node_id',
    'static_dropped_delay_bytes',
    'static_dropped_overflow_bytes',
    'tac_dropped_delay_bytes',
    'tac_dropped_overflow_bytes',
  ];

  const writer = new CsvByteWriter(65536);
  writer.writeRaw(header.join(','));
  writer.newline();
  let totalRows = 0;

  let i = 0;
  let j = 0;
  while (i < count || j < filteredEvictions.length) {
    let intervalRec = i < count ? epochStore.get(i) : null;
    while (i < count && (!intervalRec || intervalRec.endTimeS < filterT0 || intervalRec.startTimeS > filterT1)) {
      i++;
      intervalRec = i < count ? epochStore.get(i) : null;
    }

    const ev = j < filteredEvictions.length ? filteredEvictions[j] : null;
    if (intervalRec && (!ev || intervalRec.startTimeS <= ev.timestampS)) {
      writeIntervalRecordRow(writer, intervalRec, i);
      totalRows++;
      i++;
    } else if (ev) {
      writeEvictionRecordRow(writer, ev);
      totalRows++;
      j++;
    }
  }

  const evictionHistoryMetadata =
    typeof epochStore.getEvictionHistoryMetadata === 'function'
      ? epochStore.getEvictionHistoryMetadata()
      : EMPTY_CSV_EVICTION_METADATA;
  const selectedIntervalEvictionMayBeTruncated = Boolean(
    typeof epochStore.mayHaveEvictedFinalizationInTimeRange === 'function'
      ? epochStore.mayHaveEvictedFinalizationInTimeRange(filterT0, filterT1)
      : evictionHistoryMetadata.discardedEvictionCount > 0
  );
  const selectedIntervalTruncationNotice = selectedIntervalEvictionMayBeTruncated
    ? 'Retained node-eviction drop finalization history was pruned for part of this export window; exported eviction drop totals may be incomplete.'
    : null;

  const blob = writer.toBlob();
  return {
    filename,
    blob,
    rowCount: totalRows,
    byteLength: blob.size,
    selectedIntervalEvictionMayBeTruncated,
    selectedIntervalTruncationNotice,
    globalDiscardedEvictionCount: evictionHistoryMetadata.discardedEvictionCount,
    discardedEvictionCount: evictionHistoryMetadata.discardedEvictionCount,
    globalEvictionMinWatermarkTimestampS: evictionHistoryMetadata.minDiscardedTimestampS,
    globalEvictionWatermarkTimestampS: evictionHistoryMetadata.maxDiscardedTimestampS,
    evictionWatermarkTimestampS: evictionHistoryMetadata.maxDiscardedTimestampS,
    evictionHistoryMetadata,
  };
}

/**
 * Executes decoupled dual-file export with sequential browser dispatch (350 ms spacing)
 * and persistent modal fallback buttons.
 */
export async function exportTimelineDualCsv(
  options: DualExportOptions
): Promise<DualExportResult> {
  const { spatialBuffer, epochStore } = options;
  const dispatcher = options.downloadDispatcher ?? defaultDownloadDispatcher;
  const autoDispatch = options.autoDispatch ?? true;

  // 1. Generate File 1: Spatial frames CSV
  const spatialRes = generateSpatialFramesCsv(spatialBuffer, {
    timeRangeS: options.timeRangeS,
    maxNodes: options.maxNodes,
    include128Nodes: options.include128Nodes,
  });

  // 2. Generate File 2: Comm epochs CSV
  const commRes = generateCommEpochsCsv(epochStore, {
    timeRangeS: options.timeRangeS,
  });

  const downloadSpatial = () => {
    dispatcher(spatialRes.blob, spatialRes.filename);
  };

  const downloadComm = () => {
    dispatcher(commRes.blob, commRes.filename);
  };

  let dispatchedCount = 0;

  if (autoDispatch) {
    // Dispatch File 1 immediately
    downloadSpatial();
    dispatchedCount++;

    // Dispatch File 2 after 350 ms delay
    await new Promise((resolve) => setTimeout(resolve, 350));
    downloadComm();
    dispatchedCount++;
  }

  return {
    spatialFilename: spatialRes.filename,
    commFilename: commRes.filename,
    spatialBlob: spatialRes.blob,
    commBlob: commRes.blob,
    spatialBytes: spatialRes.byteLength,
    commBytes: commRes.byteLength,
    downloadSpatial,
    downloadComm,
    dispatchedCount,
    commSelectedIntervalEvictionMayBeTruncated: commRes.selectedIntervalEvictionMayBeTruncated,
    selectedIntervalEvictionMayBeTruncated: commRes.selectedIntervalEvictionMayBeTruncated,
    selectedIntervalTruncationNotice: commRes.selectedIntervalTruncationNotice,
    globalDiscardedEvictionCount: commRes.globalDiscardedEvictionCount,
    globalEvictionMinWatermarkTimestampS: commRes.globalEvictionMinWatermarkTimestampS,
    globalEvictionWatermarkTimestampS: commRes.globalEvictionWatermarkTimestampS,
    evictionHistoryMetadata: commRes.evictionHistoryMetadata,
  };
}
