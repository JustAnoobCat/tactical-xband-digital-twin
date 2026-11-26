/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Persistent Offline Mission Pack Store (OPFS / IndexedDB + Memory Fallback)
 *
 * Stores validated offline terrain & mission packs (.hgt, .tif, .tiff, .pmtiles, .json)
 * locally with strict path/extension/size validation and zero network dependencies.
 */

export type OfflineMissionPackKind = 'hgt' | 'geotiff' | 'pmtiles' | 'scenario';

export interface OfflineMissionPackMeta {
  readonly name: string;
  readonly kind: OfflineMissionPackKind;
  readonly sizeBytes: number;
  readonly savedAtIso: string;
}

export interface LoadedOfflineMissionPack extends OfflineMissionPackMeta {
  readonly bytes: Uint8Array;
}

export const ALLOWED_OFFLINE_PACK_EXTENSIONS: ReadonlySet<string> = new Set([
  '.hgt',
  '.tif',
  '.tiff',
  '.pmtiles',
  '.json',
]);

export const MAX_OFFLINE_PACK_BYTES = 256 * 1024 * 1024; // 256 MiB

const OPFS_DIR_NAME = 'xband-offline-mission-packs';
const OPFS_MANIFEST_FILE = '__manifest__.json';
const IDB_DB_NAME = 'xband-offline-mission-packs';
const IDB_STORE_NAME = 'packs';
const IDB_VERSION = 1;

export function validateOfflinePackName(rawName: string): {
  readonly name: string;
  readonly ext: string;
} {
  if (typeof rawName !== 'string') {
    throw new Error('Pack name must be a string.');
  }
  const name = rawName.trim();
  if (name.length === 0 || name.length > 180) {
    throw new Error('Pack name must be between 1 and 180 characters.');
  }
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    name.includes('\0') ||
    name.includes(':') ||
    /[\x00-\x1f\x7f]/.test(name) ||
    name.startsWith('.') ||
    name.endsWith('.')
  ) {
    throw new Error(`Invalid or unsafe offline pack name: "${rawName}"`);
  }
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx <= 0) {
    throw new Error(`Offline pack "${name}" must include a valid extension.`);
  }
  const ext = name.slice(dotIdx).toLowerCase();
  if (!ALLOWED_OFFLINE_PACK_EXTENSIONS.has(ext)) {
    throw new Error(
      `Disallowed offline pack extension "${ext}". Allowed: ${Array.from(ALLOWED_OFFLINE_PACK_EXTENSIONS).join(', ')}`
    );
  }
  return { name, ext };
}

function toUint8Array(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes.slice(0));
  }
  throw new Error('Pack payload must be an ArrayBuffer or Uint8Array.');
}

interface PackBackend {
  readonly kind: 'opfs' | 'indexeddb' | 'memory';
  save(meta: OfflineMissionPackMeta, bytes: Uint8Array): Promise<void>;
  list(): Promise<OfflineMissionPackMeta[]>;
  load(name: string): Promise<LoadedOfflineMissionPack | null>;
  delete(name: string): Promise<boolean>;
  clearAll(): Promise<void>;
}

class MemoryPackBackend implements PackBackend {
  public readonly kind = 'memory' as const;
  private readonly store = new Map<string, { meta: OfflineMissionPackMeta; bytes: Uint8Array }>();

  public async save(meta: OfflineMissionPackMeta, bytes: Uint8Array): Promise<void> {
    this.store.set(meta.name, { meta, bytes: new Uint8Array(bytes) });
  }

  public async list(): Promise<OfflineMissionPackMeta[]> {
    return Array.from(this.store.values())
      .map((entry) => entry.meta)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  public async load(name: string): Promise<LoadedOfflineMissionPack | null> {
    const entry = this.store.get(name);
    if (!entry) return null;
    return {
      ...entry.meta,
      bytes: new Uint8Array(entry.bytes),
    };
  }

  public async delete(name: string): Promise<boolean> {
    return this.store.delete(name);
  }

  public async clearAll(): Promise<void> {
    this.store.clear();
  }
}

class IndexedDbPackBackend implements PackBackend {
  public readonly kind = 'indexeddb' as const;

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME, { keyPath: 'name' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB pack store.'));
    });
  }

  public async save(meta: OfflineMissionPackMeta, bytes: Uint8Array): Promise<void> {
    const db = await this.openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.put({
          name: meta.name,
          kind: meta.kind,
          sizeBytes: meta.sizeBytes,
          savedAtIso: meta.savedAtIso,
          bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB save failed.'));
      });
    } finally {
      db.close();
    }
  }

  public async list(): Promise<OfflineMissionPackMeta[]> {
    const db = await this.openDb();
    try {
      return await new Promise<OfflineMissionPackMeta[]>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = Array.isArray(req.result) ? req.result : [];
          const metas: OfflineMissionPackMeta[] = rows.map((r) => ({
            name: String(r.name),
            kind: r.kind as OfflineMissionPackKind,
            sizeBytes: Number(r.sizeBytes ?? 0),
            savedAtIso: String(r.savedAtIso ?? ''),
          }));
          metas.sort((a, b) => a.name.localeCompare(b.name));
          resolve(metas);
        };
        req.onerror = () => reject(req.error ?? new Error('IndexedDB list failed.'));
      });
    } finally {
      db.close();
    }
  }

  public async load(name: string): Promise<LoadedOfflineMissionPack | null> {
    const db = await this.openDb();
    try {
      return await new Promise<LoadedOfflineMissionPack | null>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.get(name);
        req.onsuccess = () => {
          const r = req.result;
          if (!r) {
            resolve(null);
            return;
          }
          const rawBytes = r.bytes instanceof ArrayBuffer ? new Uint8Array(r.bytes) : new Uint8Array(r.bytes ?? []);
          resolve({
            name: String(r.name),
            kind: r.kind as OfflineMissionPackKind,
            sizeBytes: Number(r.sizeBytes ?? rawBytes.byteLength),
            savedAtIso: String(r.savedAtIso ?? ''),
            bytes: rawBytes,
          });
        };
        req.onerror = () => reject(req.error ?? new Error('IndexedDB load failed.'));
      });
    } finally {
      db.close();
    }
  }

  public async delete(name: string): Promise<boolean> {
    const db = await this.openDb();
    try {
      const existing = await this.load(name);
      if (!existing) return false;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        tx.objectStore(IDB_STORE_NAME).delete(name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed.'));
      });
      return true;
    } finally {
      db.close();
    }
  }

  public async clearAll(): Promise<void> {
    const db = await this.openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        tx.objectStore(IDB_STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clearAll failed.'));
      });
    } finally {
      db.close();
    }
  }
}

class OpfsPackBackend implements PackBackend {
  public readonly kind = 'opfs' as const;

  private async getDir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
  }

  private async readManifest(dir: FileSystemDirectoryHandle): Promise<Record<string, OfflineMissionPackMeta>> {
    try {
      const handle = await dir.getFileHandle(OPFS_MANIFEST_FILE);
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text());
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private async writeManifest(
    dir: FileSystemDirectoryHandle,
    manifest: Record<string, OfflineMissionPackMeta>
  ): Promise<void> {
    const handle = await dir.getFileHandle(OPFS_MANIFEST_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(manifest));
    await writable.close();
  }

  public async save(meta: OfflineMissionPackMeta, bytes: Uint8Array): Promise<void> {
    const dir = await this.getDir();
    const handle = await dir.getFileHandle(meta.name, { create: true });
    const writable = await handle.createWritable();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    await writable.write(copy.buffer);
    await writable.close();

    const manifest = await this.readManifest(dir);
    manifest[meta.name] = meta;
    await this.writeManifest(dir, manifest);
  }

  public async list(): Promise<OfflineMissionPackMeta[]> {
    const dir = await this.getDir();
    const manifest = await this.readManifest(dir);
    return Object.values(manifest).sort((a, b) => a.name.localeCompare(b.name));
  }

  public async load(name: string): Promise<LoadedOfflineMissionPack | null> {
    const dir = await this.getDir();
    try {
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      const buf = await file.arrayBuffer();
      const manifest = await this.readManifest(dir);
      const meta = manifest[name] ?? {
        name,
        kind: inferPackKind(name),
        sizeBytes: buf.byteLength,
        savedAtIso: new Date(file.lastModified || Date.now()).toISOString(),
      };
      return {
        ...meta,
        bytes: new Uint8Array(buf),
      };
    } catch {
      return null;
    }
  }

  public async delete(name: string): Promise<boolean> {
    const dir = await this.getDir();
    let removed = false;
    try {
      await dir.removeEntry(name);
      removed = true;
    } catch {
      removed = false;
    }
    const manifest = await this.readManifest(dir);
    if (name in manifest) {
      delete manifest[name];
      await this.writeManifest(dir, manifest);
    }
    return removed;
  }

  public async clearAll(): Promise<void> {
    const dir = await this.getDir();
    const manifest = await this.readManifest(dir);
    for (const name of Object.keys(manifest)) {
      try {
        await dir.removeEntry(name);
      } catch {
        // Ignore missing entries
      }
    }
    await this.writeManifest(dir, {});
  }
}

export function inferPackKind(filename: string): OfflineMissionPackKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.hgt')) return 'hgt';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'geotiff';
  if (lower.endsWith('.pmtiles')) return 'pmtiles';
  return 'scenario';
}

export interface OfflineMissionPackStoreOptions {
  readonly backend?: 'auto' | 'opfs' | 'indexeddb' | 'memory';
}

export class OfflineMissionPackStore {
  private readonly preferredBackend: 'auto' | 'opfs' | 'indexeddb' | 'memory';
  private resolvedBackend: PackBackend | null = null;
  private readonly memoryFallback = new MemoryPackBackend();

  constructor(options?: OfflineMissionPackStoreOptions) {
    this.preferredBackend = options?.backend ?? 'auto';
  }

  private async getBackend(): Promise<PackBackend> {
    if (this.resolvedBackend) return this.resolvedBackend;

    if (this.preferredBackend === 'memory') {
      this.resolvedBackend = this.memoryFallback;
      return this.resolvedBackend;
    }

    if (
      (this.preferredBackend === 'auto' || this.preferredBackend === 'opfs') &&
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.getDirectory === 'function'
    ) {
      try {
        const root = await navigator.storage.getDirectory();
        if (root && typeof root.getDirectoryHandle === 'function') {
          this.resolvedBackend = new OpfsPackBackend();
          return this.resolvedBackend;
        }
      } catch {
        // Fall through to IndexedDB / memory
      }
    }

    if (
      (this.preferredBackend === 'auto' || this.preferredBackend === 'indexeddb') &&
      typeof indexedDB !== 'undefined'
    ) {
      this.resolvedBackend = new IndexedDbPackBackend();
      return this.resolvedBackend;
    }

    this.resolvedBackend = this.memoryFallback;
    return this.resolvedBackend;
  }

  public async getBackendKind(): Promise<'opfs' | 'indexeddb' | 'memory'> {
    const b = await this.getBackend();
    return b.kind;
  }

  public async savePack(
    rawName: string,
    kind: OfflineMissionPackKind,
    rawBytes: ArrayBuffer | Uint8Array
  ): Promise<OfflineMissionPackMeta> {
    const { name } = validateOfflinePackName(rawName);
    const bytes = toUint8Array(rawBytes);
    if (bytes.byteLength > MAX_OFFLINE_PACK_BYTES) {
      throw new Error(
        `Offline pack "${name}" (${bytes.byteLength} bytes) exceeds 256 MiB limit.`
      );
    }
    const meta: OfflineMissionPackMeta = {
      name,
      kind,
      sizeBytes: bytes.byteLength,
      savedAtIso: new Date().toISOString(),
    };
    const backend = await this.getBackend();
    try {
      await backend.save(meta, bytes);
    } catch {
      if (backend.kind === 'opfs' && typeof indexedDB !== 'undefined') {
        this.resolvedBackend = new IndexedDbPackBackend();
        await this.resolvedBackend.save(meta, bytes);
      } else if (backend.kind !== 'memory') {
        this.resolvedBackend = this.memoryFallback;
        await this.resolvedBackend.save(meta, bytes);
      } else {
        throw new Error(`Failed to save offline pack "${name}".`);
      }
    }
    return meta;
  }

  public async listPacks(): Promise<OfflineMissionPackMeta[]> {
    const backend = await this.getBackend();
    return backend.list();
  }

  public async loadPack(rawName: string): Promise<LoadedOfflineMissionPack | null> {
    const { name } = validateOfflinePackName(rawName);
    const backend = await this.getBackend();
    return backend.load(name);
  }

  public async deletePack(rawName: string): Promise<boolean> {
    const { name } = validateOfflinePackName(rawName);
    const backend = await this.getBackend();
    return backend.delete(name);
  }

  public async clearAll(): Promise<void> {
    const backend = await this.getBackend();
    await backend.clearAll();
  }
}
