import type { AppData } from '../types';
import { MANAGED_FILE, META_FILE, decodeData, encodeData } from './parquetCodec';
import type { FileSet } from './parquetCodec';

/** The few file operations the folder store needs. Real folders and test doubles both implement it. */
export interface Dir {
  list(): Promise<string[]>;
  read(name: string): Promise<ArrayBuffer | null>;
  write(name: string, bytes: ArrayBuffer): Promise<void>;
  remove(name: string): Promise<void>;
}

export type FolderContents =
  | { status: 'empty' }
  | { status: 'ok'; data: AppData }
  | { status: 'unreadable'; message: string };

/** Last bytes written per file, so unchanged months are not rewritten. */
export type WriteCache = Map<string, ArrayBuffer>;

const sameBytes = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

/** Reads the folder. Never writes. Unreadable folders must be left exactly as they are. */
export async function inspectFolder(dir: Dir): Promise<FolderContents> {
  let names: string[];
  try {
    names = (await dir.list()).filter((n) => MANAGED_FILE.test(n));
    if (names.length === 0) return { status: 'empty' };
    const files: FileSet = new Map();
    for (const n of names) {
      const buf = await dir.read(n);
      if (buf) files.set(n, buf);
    }
    return { status: 'ok', data: await decodeData(files) };
  } catch (e) {
    return { status: 'unreadable', message: e instanceof Error ? e.message : 'The folder could not be read.' };
  }
}

/**
 * Writes the data into the folder: meta first, then changed month files, then removes managed files that no
 * longer belong (e.g. after "Erase everything"). Throws if any write fails, so the caller can report "not saved".
 */
export async function writeFolder(dir: Dir, data: AppData, cache: WriteCache, savedAt: number = Date.now()): Promise<void> {
  const files = encodeData(data, savedAt);
  const meta = files.get(META_FILE) as ArrayBuffer;
  await dir.write(META_FILE, meta);
  cache.set(META_FILE, meta);
  for (const [name, buf] of files) {
    if (name === META_FILE) continue;
    const prev = cache.get(name);
    if (prev && sameBytes(prev, buf)) continue;
    await dir.write(name, buf);
    cache.set(name, buf);
  }
  for (const name of await dir.list()) {
    if (MANAGED_FILE.test(name) && !files.has(name)) {
      await dir.remove(name);
      cache.delete(name);
    }
  }
}

// ---------- Browser folder (File System Access API, Chromium) ----------

interface PermissionHandle {
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
}
type DirHandle = FileSystemDirectoryHandle & PermissionHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
};
type Picker = (opts: { mode: 'readwrite'; id?: string }) => Promise<DirHandle>;

export const folderSupported = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window && typeof indexedDB !== 'undefined';

export async function pickFolder(): Promise<DirHandle | null> {
  try {
    return await (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker({ mode: 'readwrite', id: 'daily-quest' });
  } catch {
    return null; // cancelled
  }
}

export function dirFromHandle(handle: FileSystemDirectoryHandle): Dir {
  const h = handle as DirHandle;
  return {
    async list() {
      const names: string[] = [];
      for await (const [name, entry] of h.entries()) if (entry.kind === 'file') names.push(name);
      return names;
    },
    async read(name) {
      try {
        return await (await (await h.getFileHandle(name)).getFile()).arrayBuffer();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') return null;
        throw e;
      }
    },
    async write(name, bytes) {
      // The browser writes to a swap file and only replaces the real one when the stream closes.
      const w = await (await h.getFileHandle(name, { create: true })).createWritable();
      await w.write(bytes);
      await w.close();
    },
    async remove(name) {
      try {
        await h.removeEntry(name);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
      }
    },
  };
}

export type Permission = 'granted' | 'prompt' | 'denied';

export async function folderPermission(handle: FileSystemDirectoryHandle, ask: boolean): Promise<Permission> {
  const h = handle as PermissionHandle;
  try {
    const opts = { mode: 'readwrite' } as const;
    let p = (await h.queryPermission?.(opts)) ?? 'prompt';
    if (p !== 'granted' && ask) p = (await h.requestPermission?.(opts)) ?? 'denied';
    return p;
  } catch {
    return 'denied';
  }
}

// ---------- Remembering the chosen folder (IndexedDB) ----------

const DB = 'dailyquest';
const STORE = 'handles';
const KEY = 'folder';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const saveHandle = (h: FileSystemDirectoryHandle) => withStore('readwrite', (s) => s.put(h, KEY)).then(() => true, () => false);
export const forgetHandle = () => withStore('readwrite', (s) => s.delete(KEY)).then(() => true, () => false);
export const loadHandle = () =>
  withStore<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY)).catch(() => undefined);
