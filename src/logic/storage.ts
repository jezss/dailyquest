import type { AppData, Day } from '../types';

export const STORAGE_KEY = 'dailyquest.data';
export const BACKUP_KEY = 'dailyquest.corrupt-backup';
export const V1_BACKUP_KEY = 'dailyquest.v1-team-backup';
export const V2_BACKUP_KEY = 'dailyquest.v2-backup';
export const CURRENT_VERSION = 3;

export type LoadStatus = 'ok' | 'fresh' | 'migrated' | 'corrupt' | 'unavailable';
export interface LoadResult {
  data: AppData | null;
  status: LoadStatus;
  message?: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** v3 goals carry an explicit `kind`, and an issue item must have a source (an own item must not). */
function validGoal(g: unknown, version: number): boolean {
  if (!isObj(g) || typeof g.id !== 'string' || typeof g.title !== 'string' || typeof g.status !== 'string') return false;
  if (version < 3) return true;
  return (g.kind === 'issue' || g.kind === 'own') && (g.kind === 'issue') === isObj(g.source);
}

function validDay(date: string, v: unknown, version: number): v is Day {
  return (
    isObj(v) &&
    v.date === date &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    typeof v.focusNote === 'string' &&
    typeof v.win === 'string' &&
    typeof v.reflection === 'string' &&
    typeof v.tomorrow === 'string' &&
    Array.isArray(v.goals) &&
    v.goals.every((g) => validGoal(g, version)) &&
    Array.isArray(v.highlights) &&
    v.highlights.every((h) => isObj(h) && typeof h.key === 'string' && typeof h.title === 'string')
  );
}

function validShape(v: unknown, version: number): boolean {
  if (!isObj(v) || v.version !== version) return false;
  if (!isObj(v.days) || !Object.entries(v.days).every(([k, d]) => validDay(k, d, version))) return false;
  return isObj(v.settings) && typeof v.settings.displayName === 'string' && typeof v.settings.goalsSoftLimit === 'number';
}

export function validateData(v: unknown): v is AppData {
  return validShape(v, CURRENT_VERSION);
}

/**
 * Brings older saved data up to the current version, or returns null if it is not valid data of a version we know.
 * v2 -> v3: every goal gets a `kind` (`issue` when it was linked to a GitHub issue, otherwise `own`).
 */
export function migrateData(v: unknown): AppData | null {
  if (validateData(v)) return v;
  if (!validShape(v, 2)) return null;
  const old = v as unknown as AppData;
  const days: Record<string, Day> = {};
  for (const [date, day] of Object.entries(old.days)) {
    days[date] = { ...day, goals: day.goals.map((g) => ({ ...g, kind: g.source ? 'issue' : 'own' })) };
  }
  return { ...old, version: CURRENT_VERSION, days };
}

export function freshData(): AppData {
  return { version: CURRENT_VERSION, days: {}, settings: { displayName: '', goalsSoftLimit: 5 }, sampleLoaded: false };
}

export function loadData(store: Store | null = defaultStore()): LoadResult {
  if (!store) return { data: null, status: 'unavailable', message: 'Browser storage is unavailable.' };
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { data: null, status: 'unavailable', message: 'Browser storage is unavailable.' };
  }
  if (raw === null) return { data: null, status: 'fresh' };
  try {
    const parsed: unknown = JSON.parse(raw);
    // v1 was the team-standup app. Its data does not map onto personal days, so keep a copy and start clean.
    if (isObj(parsed) && parsed.version === 1) {
      try {
        store.setItem(V1_BACKUP_KEY, raw);
      } catch {
        /* ignore */
      }
      return { data: null, status: 'migrated', message: 'Your earlier team-standup data was kept as a backup in this browser.' };
    }
    const data = migrateData(parsed);
    if (!data) throw new Error('Saved data has an unexpected shape.');
    if (isObj(parsed) && parsed.version === 2) {
      // Keep the untouched v2 copy; the next save writes v3.
      try {
        store.setItem(V2_BACKUP_KEY, raw);
      } catch {
        /* ignore */
      }
    }
    return { data, status: 'ok' };
  } catch (e) {
    try {
      store.setItem(BACKUP_KEY, raw);
    } catch {
      /* ignore */
    }
    return { data: null, status: 'corrupt', message: e instanceof Error ? e.message : 'Saved data could not be read.' };
  }
}

/** Returns true only if the write really succeeded. */
export function saveData(data: AppData, store: Store | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
    return store.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearAll(store: Store | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.removeItem(STORAGE_KEY);
    store.removeItem(BACKUP_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Parse a user-supplied backup file (current or v2). Returns null when it is not valid data. */
export function parseBackup(text: string): AppData | null {
  try {
    const data = migrateData(JSON.parse(text) as unknown);
    return data ? { ...data, savedAt: undefined } : null;
  } catch {
    return null;
  }
}
