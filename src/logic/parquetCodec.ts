import { parquetReadObjects } from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';
import type { AppData, Day, Goal, Highlight } from '../types';
import { CURRENT_VERSION, migrateData } from './storage';

/**
 * AppData <-> a set of Parquet files, keyed by file name.
 *   meta.parquet                    one row: schema version + settings
 *   YYYY-MM.days.parquet            one row per day
 *   YYYY-MM.items.parquet           one row per goal/issue item (position keeps the order; kind = issue | own)
 *   YYYY-MM.highlights.parquet      one row per pinned highlight
 * Data version 2 stored items as YYYY-MM.goals.parquet; those files are still read, and removed on the next write.
 * Months are separate files because Parquet cannot be appended to: only the month being edited is rewritten.
 */

export type FileSet = Map<string, ArrayBuffer>;
type Row = Record<string, unknown>;
type Col = { name: string; type: 'STRING' | 'INT32' | 'INT64' | 'BOOLEAN'; nullable?: boolean };

export const MANAGED_FILE = /^(meta|\d{4}-\d{2}\.(days|items|goals|highlights))\.parquet$/;
export const META_FILE = 'meta.parquet';

const DAYS_COLS: Col[] = [
  { name: 'date', type: 'STRING' },
  { name: 'focusNote', type: 'STRING' },
  { name: 'win', type: 'STRING' },
  { name: 'reflection', type: 'STRING' },
  { name: 'tomorrow', type: 'STRING' },
  { name: 'carryDismissed', type: 'BOOLEAN' },
];
const ITEMS_COLS: Col[] = [
  { name: 'date', type: 'STRING' },
  { name: 'position', type: 'INT32' },
  { name: 'id', type: 'STRING' },
  { name: 'kind', type: 'STRING' },
  { name: 'title', type: 'STRING' },
  { name: 'note', type: 'STRING' },
  { name: 'status', type: 'STRING' },
  { name: 'focus', type: 'BOOLEAN' },
  { name: 'createdAt', type: 'INT64' },
  { name: 'doneAt', type: 'INT64', nullable: true },
  { name: 'carriedFrom', type: 'STRING', nullable: true },
  { name: 'carried', type: 'BOOLEAN' },
  { name: 'repo', type: 'STRING', nullable: true },
  { name: 'number', type: 'INT32', nullable: true },
  { name: 'url', type: 'STRING', nullable: true },
  { name: 'state', type: 'STRING', nullable: true },
];
const HIGHLIGHTS_COLS: Col[] = [
  { name: 'date', type: 'STRING' },
  { name: 'position', type: 'INT32' },
  { name: 'id', type: 'STRING' },
  { name: 'key', type: 'STRING' },
  { name: 'kind', type: 'STRING' },
  { name: 'title', type: 'STRING' },
  { name: 'url', type: 'STRING' },
  { name: 'repo', type: 'STRING' },
  { name: 'at', type: 'INT64' },
];
const META_COLS: Col[] = [
  { name: 'version', type: 'INT32' },
  { name: 'displayName', type: 'STRING' },
  { name: 'goalsSoftLimit', type: 'INT32' },
  { name: 'sampleLoaded', type: 'BOOLEAN' },
  { name: 'savedAt', type: 'INT64', nullable: true },
];

const big = (n: number | null | undefined) => (n == null ? null : BigInt(Math.round(n)));
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function toBuffer(cols: Col[], rows: Row[]): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: cols.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable ?? false,
      data: rows.map((r) => {
        const v = r[c.name];
        if (c.type === 'INT64') return v == null && !c.nullable ? 0n : big(v as number | null);
        if (v == null) return c.nullable ? null : c.type === 'STRING' ? '' : c.type === 'BOOLEAN' ? false : 0;
        return v;
      }) as never,
    })),
  });
}

async function fromBuffer(buf: ArrayBuffer): Promise<Row[]> {
  return (await parquetReadObjects({ file: buf })) as Row[];
}

const monthOf = (date: string) => date.slice(0, 7);

function goalRow(date: string, position: number, g: Goal): Row {
  return {
    date,
    position,
    id: g.id,
    kind: g.kind,
    title: g.title,
    note: g.note,
    status: g.status,
    focus: !!g.focus,
    createdAt: g.createdAt,
    doneAt: g.doneAt,
    carriedFrom: g.carriedFrom ?? null,
    carried: !!g.carried,
    repo: g.source?.repo ?? null,
    number: g.source?.number ?? null,
    url: g.source?.url ?? null,
    state: g.source?.state ?? null,
  };
}

function highlightRow(date: string, position: number, h: Highlight): Row {
  return { date, position, id: h.id, key: h.key, kind: h.kind, title: h.title, url: h.url, repo: h.repo, at: h.at };
}

export function encodeData(data: AppData, savedAt: number = Date.now()): FileSet {
  const files: FileSet = new Map();
  files.set(
    META_FILE,
    toBuffer(META_COLS, [
      { version: data.version, displayName: data.settings.displayName, goalsSoftLimit: data.settings.goalsSoftLimit, sampleLoaded: data.sampleLoaded, savedAt },
    ]),
  );
  const months = new Map<string, { days: Row[]; goals: Row[]; highlights: Row[] }>();
  for (const date of Object.keys(data.days).sort()) {
    const d = data.days[date];
    const m = months.get(monthOf(date)) ?? { days: [], goals: [], highlights: [] };
    months.set(monthOf(date), m);
    m.days.push({ date, focusNote: d.focusNote, win: d.win, reflection: d.reflection, tomorrow: d.tomorrow, carryDismissed: !!d.carryDismissed });
    d.goals.forEach((g, i) => m.goals.push(goalRow(date, i, g)));
    d.highlights.forEach((h, i) => m.highlights.push(highlightRow(date, i, h)));
  }
  for (const [month, m] of months) {
    files.set(`${month}.days.parquet`, toBuffer(DAYS_COLS, m.days));
    if (m.goals.length) files.set(`${month}.items.parquet`, toBuffer(ITEMS_COLS, m.goals));
    if (m.highlights.length) files.set(`${month}.highlights.parquet`, toBuffer(HIGHLIGHTS_COLS, m.highlights));
  }
  return files;
}

/** Throws with a readable message when the files are not valid Daily Quest data. */
export async function decodeData(files: FileSet): Promise<AppData> {
  const metaBuf = files.get(META_FILE);
  if (!metaBuf) throw new Error('meta.parquet is missing.');
  const [meta] = await fromBuffer(metaBuf);
  if (!meta) throw new Error('meta.parquet is empty.');
  const version = num(meta.version);
  if (version > CURRENT_VERSION) throw new Error(`These files were written by a newer version of Daily Quest (data version ${version}).`);
  if (version !== CURRENT_VERSION && version !== 2) throw new Error(`Unsupported data version ${version}.`);

  const days: Record<string, Day> = {};
  const goalsByDate = new Map<string, Goal[]>();
  const highlightsByDate = new Map<string, Highlight[]>();

  for (const name of [...files.keys()].sort()) {
    const buf = files.get(name) as ArrayBuffer;
    const legacy = name.endsWith('.goals.parquet'); // data version 2: no kind, source* column names
    // If a month has both (an interrupted upgrade), the newer items file wins.
    if (legacy && files.has(name.replace('.goals.', '.items.'))) continue;
    if (legacy || name.endsWith('.items.parquet')) {
      const rows = (await fromBuffer(buf)).sort((a, b) => num(a.position) - num(b.position));
      for (const r of rows) {
        const repo = legacy ? r.sourceRepo : r.repo;
        const g: Goal = {
          id: str(r.id),
          kind: repo != null ? 'issue' : 'own',
          title: str(r.title),
          note: str(r.note),
          status: str(r.status) as Goal['status'],
          focus: r.focus === true,
          createdAt: num(r.createdAt),
          doneAt: r.doneAt == null ? null : num(r.doneAt),
        };
        if (r.carriedFrom != null) g.carriedFrom = str(r.carriedFrom);
        if (r.carried === true) g.carried = true;
        if (repo != null) {
          g.source = { type: 'github', repo: str(repo), number: num(legacy ? r.sourceNumber : r.number), url: str(legacy ? r.sourceUrl : r.url) };
          if (!legacy && (r.state === 'open' || r.state === 'closed')) g.source.state = r.state;
        }
        const list = goalsByDate.get(str(r.date)) ?? [];
        list.push(g);
        goalsByDate.set(str(r.date), list);
      }
    } else if (name.endsWith('.highlights.parquet')) {
      const rows = (await fromBuffer(buf)).sort((a, b) => num(a.position) - num(b.position));
      for (const r of rows) {
        const h: Highlight = { id: str(r.id), key: str(r.key), kind: str(r.kind) as Highlight['kind'], title: str(r.title), url: str(r.url), repo: str(r.repo), at: num(r.at) };
        const list = highlightsByDate.get(str(r.date)) ?? [];
        list.push(h);
        highlightsByDate.set(str(r.date), list);
      }
    }
  }
  for (const name of [...files.keys()].sort()) {
    if (!name.endsWith('.days.parquet')) continue;
    for (const r of await fromBuffer(files.get(name) as ArrayBuffer)) {
      const date = str(r.date);
      days[date] = {
        date,
        focusNote: str(r.focusNote),
        goals: goalsByDate.get(date) ?? [],
        highlights: highlightsByDate.get(date) ?? [],
        win: str(r.win),
        reflection: str(r.reflection),
        tomorrow: str(r.tomorrow),
        carryDismissed: r.carryDismissed === true,
      };
    }
  }
  const data: AppData = {
    version,
    days,
    settings: { displayName: str(meta.displayName), goalsSoftLimit: num(meta.goalsSoftLimit) },
    sampleLoaded: meta.sampleLoaded === true,
  };
  if (meta.savedAt != null) data.savedAt = num(meta.savedAt);
  const current = migrateData(data); // upgrades version 2 data; also validates
  if (!current) throw new Error('The files do not contain valid Daily Quest data.');
  return current;
}
