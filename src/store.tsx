import { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppData, Day, Settings } from './types';
import { clearAll, freshData, loadData, saveData } from './logic/storage';
import type { LoadStatus } from './logic/storage';
import { getDay, putDay } from './logic/days';
import { makeSampleData } from './logic/sample';

type Action = { type: 'replace'; data: AppData } | { type: 'update'; fn: (d: AppData) => AppData };

function reducer(d: AppData, a: Action): AppData {
  return a.type === 'replace' ? a.data : a.fn(d);
}

export type SaveState = 'saved' | 'failed' | 'idle';

interface Ctx {
  data: AppData;
  saveState: SaveState;
  loadStatus: LoadStatus;
  loadMessage?: string;
  update: (fn: (d: AppData) => AppData) => void;
  updateDay: (date: string, fn: (day: Day) => Day) => void;
  setSettings: (p: Partial<Settings>) => void;
  replaceAll: (d: AppData) => void;
  resetEverything: (sample: boolean) => void;
  dismissNotice: () => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('StoreProvider missing');
  return c;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => loadData());
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(initial.status);
  const [loadMessage, setLoadMessage] = useState(initial.message);
  const [data, dispatch] = useReducer(reducer, initial.data ?? freshData());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const blocked = loadStatus === 'corrupt'; // never overwrite unreadable data until the user chooses

  useEffect(() => {
    if (blocked) return;
    setSaveState(saveData(data) ? 'saved' : 'failed');
  }, [data, blocked]);

  const value = useMemo<Ctx>(
    () => ({
      data,
      saveState,
      loadStatus,
      loadMessage,
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
    }),
    [data, saveState, loadStatus, loadMessage],
  );
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
