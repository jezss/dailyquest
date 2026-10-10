import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppData, Day, Settings } from './types';
import { clearAll, freshData, loadData, saveData } from './logic/storage';
import type { LoadStatus } from './logic/storage';
import { getDay, putDay } from './logic/days';
import { makeSampleData } from './logic/sample';
import {
  dirFromHandle,
  folderPermission,
  folderSupported,
  forgetHandle,
  inspectFolder,
  loadHandle,
  pickFolder,
  saveHandle,
  writeFolder,
} from './logic/folderStore';
import type { Dir, WriteCache } from './logic/folderStore';

type Action = { type: 'replace'; data: AppData } | { type: 'update'; fn: (d: AppData) => AppData };

function reducer(d: AppData, a: Action): AppData {
  return a.type === 'replace' ? a.data : a.fn(d);
}

export type SaveState = 'saved' | 'failed' | 'idle';

/** Where the data lives. `none` = browser storage only. */
export type FolderPhase = 'unsupported' | 'checking' | 'none' | 'needs-permission' | 'connected' | 'error';
export interface FolderState {
  phase: FolderPhase;
  name?: string;
  message?: string;
}
/** A chosen folder that already holds Daily Quest data: the user decides whether to use it. */
export interface PendingFolder {
  name: string;
  days: number;
}

interface Ctx {
  data: AppData;
  saveState: SaveState;
  loadStatus: LoadStatus;
  loadMessage?: string;
  folder: FolderState;
  pendingFolder: PendingFolder | null;
  update: (fn: (d: AppData) => AppData) => void;
  updateDay: (date: string, fn: (day: Day) => Day) => void;
  setSettings: (p: Partial<Settings>) => void;
  replaceAll: (d: AppData) => void;
  resetEverything: (sample: boolean) => void;
  dismissNotice: () => void;
  chooseFolder: () => Promise<void>;
  reconnectFolder: () => Promise<void>;
  disconnectFolder: () => Promise<void>;
  resolvePendingFolder: (useIt: boolean) => Promise<void>;
}

const StoreCtx = createContext<Ctx | null>(null);

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('StoreProvider missing');
  return c;
}

const WRITE_DELAY_MS = 250;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => loadData());
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(initial.status);
  const [loadMessage, setLoadMessage] = useState(initial.message);
  const [data, dispatch] = useReducer(reducer, initial.data ?? freshData());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [folder, setFolder] = useState<FolderState>({ phase: folderSupported() ? 'checking' : 'unsupported' });
  const [pendingFolder, setPendingFolder] = useState<PendingFolder | null>(null);
  const blocked = loadStatus === 'corrupt'; // never overwrite unreadable data until the user chooses

  const dirRef = useRef<Dir | null>(null);
  const cacheRef = useRef<WriteCache>(new Map());
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef<{ handle: FileSystemDirectoryHandle; data: AppData } | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const connected = folder.phase === 'connected';

  // Save on every change. The browser copy is always kept as a cache; when a folder is connected, "saved" means the
  // folder write succeeded.
  useEffect(() => {
    if (blocked) return;
    const local = saveData(data);
    const dir = dirRef.current;
    if (!connected || !dir) {
      setSaveState(local ? 'saved' : 'failed');
      return;
    }
    const t = setTimeout(() => {
      chainRef.current = chainRef.current
        .then(() => writeFolder(dir, data, cacheRef.current))
        .then(
          () => setSaveState('saved'),
          () => setSaveState('failed'),
        );
    }, WRITE_DELAY_MS);
    return () => clearTimeout(t);
  }, [data, blocked, connected]);

  /** Write the current data into a freshly connected folder and mark it connected. Returns false if the write failed. */
  const connect = useCallback(async (handle: FileSystemDirectoryHandle, writeNow: AppData | null): Promise<boolean> => {
    const dir = dirFromHandle(handle);
    cacheRef.current = new Map();
    try {
      if (writeNow) await writeFolder(dir, writeNow, cacheRef.current);
    } catch (e) {
      setFolder({ phase: 'error', name: handle.name, message: `Could not write to the folder: ${e instanceof Error ? e.message : 'unknown error'}` });
      return false;
    }
    dirRef.current = dir;
    await saveHandle(handle);
    setFolder({ phase: 'connected', name: handle.name });
    return true;
  }, []);

  /** Look inside a folder and connect it, adopt its data, or report it as unreadable. `ask` allows a permission prompt. */
  const openFolder = useCallback(
    async (handle: FileSystemDirectoryHandle, ask: boolean, confirmExisting: boolean) => {
      const perm = await folderPermission(handle, ask);
      if (perm !== 'granted') {
        setFolder({ phase: 'needs-permission', name: handle.name, message: perm === 'denied' && ask ? 'Permission to use the folder was not given.' : undefined });
        return;
      }
      const found = await inspectFolder(dirFromHandle(handle));
      if (found.status === 'unreadable') {
        // Left exactly as it is: nothing is written and nothing is connected.
        setFolder({ phase: 'error', name: handle.name, message: `This folder was not changed. ${found.message}` });
        return;
      }
      if (found.status === 'empty') {
        await connect(handle, dataRef.current);
        return;
      }
      const mine = dataRef.current;
      const hasLocal = Object.keys(mine.days).length > 0;
      if (confirmExisting && hasLocal) {
        pendingRef.current = { handle, data: found.data };
        setPendingFolder({ name: handle.name, days: Object.keys(found.data.days).length });
        setFolder({ phase: 'none' });
        return;
      }
      // Reconnecting after the folder was unavailable: keep whichever copy is newer.
      if (hasLocal && (mine.savedAt ?? 0) > (found.data.savedAt ?? 0)) {
        await connect(handle, mine);
        return;
      }
      dispatch({ type: 'replace', data: found.data });
      await connect(handle, null);
    },
    [connect],
  );

  // On start, reconnect to the folder remembered from last time.
  useEffect(() => {
    if (!folderSupported()) return;
    let live = true;
    loadHandle().then((handle) => {
      if (!live) return;
      if (!handle) setFolder({ phase: 'none' });
      else void openFolder(handle, false, false);
    });
    return () => {
      live = false;
    };
  }, [openFolder]);

  const chooseFolder = useCallback(async () => {
    const handle = await pickFolder();
    if (!handle) return;
    setFolder({ phase: 'checking', name: handle.name });
    await openFolder(handle, true, true);
  }, [openFolder]);

  const reconnectFolder = useCallback(async () => {
    const handle = await loadHandle();
    if (!handle) return setFolder({ phase: 'none' });
    await openFolder(handle, true, false);
  }, [openFolder]);

  const disconnectFolder = useCallback(async () => {
    await chainRef.current;
    dirRef.current = null;
    cacheRef.current = new Map();
    await forgetHandle();
    setFolder({ phase: 'none' });
  }, []);

  const resolvePendingFolder = useCallback(
    async (useIt: boolean) => {
      const p = pendingRef.current;
      pendingRef.current = null;
      setPendingFolder(null);
      if (!p || !useIt) return;
      dispatch({ type: 'replace', data: p.data });
      setLoadStatus('ok');
      setLoadMessage(undefined);
      await connect(p.handle, null);
    },
    [connect],
  );

  const value = useMemo<Ctx>(
    () => ({
      data,
      saveState,
      loadStatus,
      loadMessage,
      folder,
      pendingFolder,
      update: (fn) => dispatch({ type: 'update', fn }),
      updateDay: (date, fn) => dispatch({ type: 'update', fn: (d) => putDay(d, fn(getDay(d, date))) }),
      setSettings: (p) => dispatch({ type: 'update', fn: (d) => ({ ...d, settings: { ...d.settings, ...p } }) }),
      replaceAll: (d) => {
        dispatch({ type: 'replace', data: d });
        setLoadStatus('ok');
        setLoadMessage(undefined);
      },
      resetEverything: (sample) => {
        clearAll();
        dispatch({ type: 'replace', data: sample ? makeSampleData() : freshData() });
        setLoadStatus('ok');
        setLoadMessage(undefined);
      },
      dismissNotice: () => {
        setLoadStatus('ok');
        setLoadMessage(undefined);
      },
      chooseFolder,
      reconnectFolder,
      disconnectFolder,
      resolvePendingFolder,
    }),
    [data, saveState, loadStatus, loadMessage, folder, pendingFolder, chooseFolder, reconnectFolder, disconnectFolder, resolvePendingFolder],
  );
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
