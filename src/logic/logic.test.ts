import { describe, expect, it } from 'vitest';
import type { AppData, Day } from '../types';
import {
  addGoal,
  addIssueItem,
  carryCandidates,
  carryOver,
  currentStreak,
  dayStats,
  emptyDay,
  issueIndex,
  issueLog,
  linkToIssue,
  moveGoal,
  moveWithinKind,
  newGoal,
  putDay,
  removeGoal,
  setGoalStatus,
  setIssueState,
  togglePin,
  toggleFocus,
  updateGoal,
} from './days';
import { evaluateAchievements } from './achievements';
import { buildDaySummary, buildIssueLog, buildWeekSummary } from './summary';
import { BACKUP_KEY, V1_BACKUP_KEY, V2_BACKUP_KEY, freshData, loadData, migrateData, parseBackup, saveData } from './storage';
import {
  commitHighlight,
  fetchActivity,
  parseConfig,
  prHighlight,
  safeUrl,
} from './github';
import { makeSampleData } from './sample';
import { inspectFolder, writeFolder } from './folderStore';
import type { Dir } from './folderStore';

const NOW = new Date(2026, 5, 10, 12).getTime();
const D = (n: number) => `2026-06-${String(n).padStart(2, '0')}`;

function withDay(d: AppData, date: string, fn: (day: Day) => Day): AppData {
  return putDay(d, fn(d.days[date] ?? emptyDay(date)));
}

function done(d: AppData, date: string, titles: string[], focus?: string): AppData {
  return withDay(d, date, (day) => {
    for (const t of titles) day = addGoal(day, t, NOW);
    for (const g of day.goals) day = setGoalStatus(day, g.id, 'done', NOW);
    if (focus) day = toggleFocus(day, day.goals.find((g) => g.title === focus)!.id);
    return day;
  });
}

describe('goals', () => {
  it('ignores empty titles and trims', () => {
    expect(addGoal(emptyDay(D(1)), '   ', NOW).goals).toHaveLength(0);
    expect(addGoal(emptyDay(D(1)), '  Write tests ', NOW).goals[0].title).toBe('Write tests');
  });
  it('status is only changed explicitly, and doneAt follows it', () => {
    let day = addGoal(emptyDay(D(1)), 'A', NOW);
    const id = day.goals[0].id;
    expect(day.goals[0].status).toBe('todo');
    day = setGoalStatus(day, id, 'done', NOW);
    expect(day.goals[0].doneAt).toBe(NOW);
    day = setGoalStatus(day, id, 'todo', NOW + 1);
    expect(day.goals[0].doneAt).toBeNull();
  });
  it('only one focus goal; toggling again clears it', () => {
    let day = addGoal(addGoal(emptyDay(D(1)), 'A', NOW), 'B', NOW);
    const [a, b] = day.goals.map((g) => g.id);
    day = toggleFocus(day, a);
    day = toggleFocus(day, b);
    expect(day.goals.filter((g) => g.focus).map((g) => g.id)).toEqual([b]);
    day = toggleFocus(day, b);
    expect(day.goals.some((g) => g.focus)).toBe(false);
  });
  it('reorders and removes', () => {
    let day = addGoal(addGoal(emptyDay(D(1)), 'A', NOW), 'B', NOW);
    day = moveGoal(day, day.goals[1].id, -1);
    expect(day.goals.map((g) => g.title)).toEqual(['B', 'A']);
    expect(moveGoal(day, day.goals[0].id, -1)).toBe(day);
    expect(removeGoal(day, day.goals[0].id).goals).toHaveLength(1);
  });
  it('stats ignore skipped goals and only count done as done', () => {
    let day = emptyDay(D(1));
    for (const t of ['A', 'B', 'C']) day = addGoal(day, t, NOW);
    day = setGoalStatus(day, day.goals[0].id, 'done', NOW);
    day = setGoalStatus(day, day.goals[1].id, 'skipped', NOW);
    let s = dayStats(day);
    expect([s.done, s.total, s.skipped, s.open, s.percent, s.allDone]).toEqual([1, 3, 1, 1, 50, false]);
    day = setGoalStatus(day, day.goals[2].id, 'done', NOW);
    s = dayStats(day);
    expect(s.allDone).toBe(true);
    expect(dayStats(emptyDay(D(1))).allDone).toBe(false);
  });
});

describe('carry over', () => {
  it('offers unfinished goals once, copies them, and marks originals', () => {
    let d = freshData();
    d = withDay(d, D(8), (day) => addGoal(addGoal(day, 'Unfinished', NOW), 'Finished', NOW));
    d = withDay(d, D(8), (day) => setGoalStatus(day, day.goals[1].id, 'done', NOW));
    const c = carryCandidates(d, D(9))!;
    expect(c.from).toBe(D(8));
    expect(c.goals.map((g) => g.title)).toEqual(['Unfinished']);
    d = carryOver(d, D(9), D(8), c.goals.map((g) => g.id), NOW);
    expect(d.days[D(9)].goals[0]).toMatchObject({ title: 'Unfinished', status: 'todo', carriedFrom: D(8) });
    expect(carryCandidates(d, D(9))).toBeNull();
  });
  it('does not offer goals from days after the target', () => {
    const d = withDay(freshData(), D(12), (day) => addGoal(day, 'Later', NOW));
    expect(carryCandidates(d, D(9))).toBeNull();
  });
});

describe('streak and achievements', () => {
  it('streak counts consecutive active days and survives a quiet morning', () => {
    let d = done(freshData(), D(7), ['x']);
    d = done(d, D(8), ['y']);
    d = done(d, D(9), ['z']);
    expect(currentStreak(d, D(9))).toBe(3);
    expect(currentStreak(d, D(10))).toBe(3); // today empty so far
    expect(currentStreak(d, D(11))).toBe(0); // a whole day missed
  });
  it('a pinned highlight makes a day active', () => {
    const d = withDay(freshData(), D(5), (day) =>
      togglePin(day, { key: 'commit:a/b:1', kind: 'commit', title: 't', url: 'https://x', repo: 'a/b', at: NOW }),
    );
    expect(currentStreak(d, D(5))).toBe(1);
  });
  it('awards only what the records show', () => {
    expect(evaluateAchievements(freshData())).toEqual([]);
    let d = done(freshData(), D(1), ['a', 'b', 'c'], 'a');
    d = done(d, D(2), ['d'], 'd');
    let ids = evaluateAchievements(d).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['first-goal', 'clean-sweep']));
    expect(ids).not.toContain('steady-3');
    expect(ids).not.toContain('shipper');
    d = done(d, D(3), ['e'], 'e');
    ids = evaluateAchievements(d).map((e) => e.id);
    expect(ids).toContain('steady-3');
    expect(ids).toContain('focus-finisher');
    expect(ids).not.toContain('steady-7');
  });
  it('a clean sweep needs 3+ goals and skipped goals do not block it', () => {
    let d = done(freshData(), D(1), ['a', 'b']);
    expect(evaluateAchievements(d).map((e) => e.id)).not.toContain('clean-sweep');
    d = withDay(done(freshData(), D(1), ['a', 'b', 'c']), D(1), (day) => addGoal(day, 'x', NOW));
    d = withDay(d, D(1), (day) => setGoalStatus(day, day.goals[day.goals.length - 1].id, 'skipped', NOW));
    expect(evaluateAchievements(d).map((e) => e.id)).toContain('clean-sweep');
  });
  it('shipper and issue-closer come from PRs/issues, not commits', () => {
    const pr = prHighlight({ repo: 'a/b', number: 4, title: 'Fix', url: 'https://x', mergedAt: new Date(NOW).toISOString() });
    const cm = commitHighlight({ repo: 'a/b', sha: 'abcdef1', title: 'wip', url: 'https://x', at: new Date(NOW).toISOString() });
    let d = withDay(freshData(), D(1), (day) => togglePin(day, cm));
    expect(evaluateAchievements(d).map((e) => e.id)).not.toContain('shipper');
    d = withDay(d, D(1), (day) => togglePin(day, pr));
    expect(evaluateAchievements(d).map((e) => e.id)).toContain('shipper');
  });
  it('pinning twice toggles off, never duplicates', () => {
    const h = { key: 'k', kind: 'commit' as const, title: 't', url: 'https://x', repo: 'a/b', at: NOW };
    let day = togglePin(emptyDay(D(1)), h);
    expect(day.highlights).toHaveLength(1);
    day = togglePin(day, h);
    expect(day.highlights).toHaveLength(0);
  });
});

describe('summary', () => {
  it('lists real data only and labels empties', () => {
    expect(buildDaySummary(emptyDay(D(1)))).toContain('- No issues on this day.');
    let day = addGoal(addGoal(emptyDay(D(1)), 'Ship it', NOW, { source: { type: 'github', repo: 'a/b', number: 9, url: 'https://x/9' } }), 'Open one', NOW);
    day = setGoalStatus(day, day.goals[0].id, 'done', NOW);
    day = { ...day, win: 'Nice' };
    const t = buildDaySummary(day, 'Sam');
    expect(t).toContain("SAM'S DAY");
    expect(t).toContain('- [done] a/b#9 Ship it');
    expect(t).toContain('  https://x/9');
    expect(t).toContain('NOT ON GITHUB');
    expect(t).toContain('- [not started] Open one');
    expect(t).toContain('Win: Nice');
    expect(t).toContain('Done: 1 of 2');
    expect(t).not.toContain('FOR TOMORROW');
  });
  it('leads with issues (with their day note), then other work, then reflection', () => {
    let day = addGoal(emptyDay(D(1)), 'Gym', NOW);
    day = addIssueItem(day, { type: 'github', repo: 'a/b', number: 9, url: 'https://x/9' }, 'Ship it', NOW);
    day = updateGoal(day, day.goals[1].id, { note: 'merged\nwaiting on review' });
    const t = buildDaySummary({ ...day, win: 'Nice' });
    expect(t.indexOf('ISSUES')).toBeLessThan(t.indexOf('NOT ON GITHUB'));
    expect(t.indexOf('NOT ON GITHUB')).toBeLessThan(t.indexOf('REFLECTION'));
    expect(t).toContain('  Note: merged\n        waiting on review');
    expect(t).toContain('- Issues on this day: 1');
  });
  it('labels an empty issue section', () => {
    expect(buildDaySummary(addGoal(emptyDay(D(1)), 'Gym', NOW))).toContain('- No issues on this day.');
  });
  it('week summary groups notes by issue and totals other work', () => {
    const s = { type: 'github' as const, repo: 'a/b', number: 9, url: 'https://x/9' };
    let d = freshData();
    d = withDay(d, D(1), (day) => addIssueItem(addGoal(day, 'Gym', NOW), s, 'Ship it', NOW));
    d = withDay(d, D(2), (day) => {
      day = addIssueItem(day, s, 'Ship it', NOW);
      day = updateGoal(day, day.goals[0].id, { note: 'done at last' });
      return setGoalStatus(day, day.goals[0].id, 'done', NOW);
    });
    const t = buildWeekSummary([d.days[D(1)], d.days[D(2)], emptyDay(D(3))]);
    expect(t).toContain('- a/b#9 Ship it');
    expect(t).toMatch(/\[done\] done at last/);
    expect(t).toContain('- Issues worked: 1 (1 ending the week done)');
    expect(t).toContain('- Other items done: 0 of 1');
    expect(buildWeekSummary([emptyDay(D(1))])).toContain('- No issues this week.');
  });
  it('builds a per-issue log', () => {
    const s = { type: 'github' as const, repo: 'a/b', number: 9, url: 'https://x/9' };
    let d = withDay(freshData(), D(1), (day) => addIssueItem(day, s, 'Ship it', NOW));
    d = withDay(d, D(2), (day) => {
      day = addIssueItem(day, s, 'Ship it', NOW);
      return updateGoal(day, day.goals[0].id, { note: 'went well' });
    });
    const t = buildIssueLog(s, 'Ship it', issueLog(d, s));
    expect(t.split('\n')[0]).toBe('a/b#9 Ship it');
    expect(t).toContain('(no note)');
    expect(t).toContain('Note: went well');
    expect(buildIssueLog(s, 'Ship it', [])).toContain('Never on a day yet.');
  });
});

describe('storage', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  it('round-trips and validates', () => {
    const st = mem();
    const d = makeSampleData(NOW);
    expect(saveData(d, st)).toBe(true);
    const r = loadData(st);
    expect(r.status).toBe('ok');
    expect(Object.keys(r.data!.days)).toHaveLength(5);
  });
  it('fresh storage is fresh; failed saves are reported', () => {
    expect(loadData(mem()).status).toBe('fresh');
    expect(saveData(freshData(), { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} })).toBe(false);
  });
  it('corrupt data is backed up, not overwritten', () => {
    const st = mem();
    st.setItem('dailyquest.data', '{nope');
    expect(loadData(st).status).toBe('corrupt');
    expect(st.m.get(BACKUP_KEY)).toBe('{nope');
    st.setItem('dailyquest.data', JSON.stringify({ version: 2, days: { '2026-01-01': { date: 'x' } }, settings: {} }));
    expect(loadData(st).status).toBe('corrupt');
  });
  it('old v1 team data is kept as a backup and replaced by a fresh start', () => {
    const st = mem();
    const v1 = JSON.stringify({ version: 1, team: {} });
    st.setItem('dailyquest.data', v1);
    expect(loadData(st).status).toBe('migrated');
    expect(st.m.get(V1_BACKUP_KEY)).toBe(v1);
  });
  it('imports only valid backups', () => {
    expect(parseBackup('garbage')).toBeNull();
    expect(parseBackup(JSON.stringify(makeSampleData(NOW)))).not.toBeNull();
  });
});

describe('issues as items (v3)', () => {
  const src = (n: number, state?: 'open' | 'closed') => ({ type: 'github' as const, repo: 'o/r', number: n, url: `https://github.com/o/r/issues/${n}`, ...(state ? { state } : {}) });

  it('kind follows source', () => {
    expect(newGoal('own thing', NOW).kind).toBe('own');
    expect(newGoal('issue', NOW, { source: src(1) }).kind).toBe('issue');
  });
  it('an issue is on a day at most once', () => {
    let day = emptyDay(D(1));
    day = addIssueItem(day, src(1), 'Fix it', NOW);
    day = addIssueItem(day, src(1), 'Fix it again', NOW);
    day = addIssueItem(day, src(2), 'Other', NOW);
    expect(day.goals.map((g) => g.title)).toEqual(['Fix it', 'Other']);
    expect(day.goals.every((g) => g.kind === 'issue' && g.status === 'todo')).toBe(true);
  });
  it('turns an own item into an issue item in place', () => {
    let day = addGoal(emptyDay(D(1)), 'Spike the parser', NOW);
    const id = day.goals[0].id;
    day = linkToIssue(day, id, src(5));
    expect(day.goals).toHaveLength(1);
    expect(day.goals[0]).toMatchObject({ id, kind: 'issue', title: 'Spike the parser' });
    expect(day.goals[0].source?.number).toBe(5);
    expect(linkToIssue(day, id, src(6))).toBe(day); // already an issue item: unchanged
  });
  it('folds an own item into the note when the issue is already on that day', () => {
    let day = addIssueItem(emptyDay(D(1)), src(5), 'Parser', NOW);
    day = updateGoal(day, day.goals[0].id, { note: 'started' });
    day = addGoal(day, 'Try regex', NOW, { note: 'too slow' });
    day = linkToIssue(day, day.goals[1].id, src(5));
    expect(day.goals).toHaveLength(1);
    expect(day.goals[0].note).toBe('started\nTry regex — too slow');
  });
  it('builds a per-issue log and an index across days', () => {
    let d = freshData();
    d = withDay(d, D(1), (day) => addIssueItem(day, src(1), 'Fix it', NOW));
    d = withDay(d, D(2), (day) => addGoal(addIssueItem(day, src(1), 'Fix it', NOW), 'no issue', NOW));
    d = withDay(d, D(3), (day) => {
      day = addIssueItem(day, src(1), 'Fix it (renamed)', NOW);
      day = updateGoal(day, day.goals[0].id, { note: 'merged the fix' });
      return setGoalStatus(day, day.goals[0].id, 'done', NOW);
    });
    d = withDay(d, D(3), (day) => addIssueItem(day, src(2), 'Other', NOW));
    const log = issueLog(d, { repo: 'o/r', number: 1 });
    expect(log.map((e) => e.date)).toEqual([D(1), D(2), D(3)]);
    expect(log[2]).toMatchObject({ status: 'done', note: 'merged the fix' });
    const idx = issueIndex(d);
    expect(idx.map((i) => i.source.number)).toEqual([1, 2]); // both last worked on D(3); title order breaks the tie
    const one = idx.find((i) => i.source.number === 1)!;
    expect(one).toMatchObject({ days: 3, firstDate: D(1), lastDate: D(3), lastStatus: 'done', notes: 1, title: 'Fix it (renamed)' });
  });
  it('setIssueState updates snapshots without touching status', () => {
    let d = freshData();
    d = withDay(d, D(1), (day) => addIssueItem(day, src(1, 'open'), 'A', NOW));
    d = withDay(d, D(2), (day) => addIssueItem(day, src(1, 'open'), 'A', NOW));
    const same = setIssueState(d, { repo: 'o/r', number: 1 }, 'open');
    expect(same).toBe(d);
    const next = setIssueState(d, { repo: 'o/r', number: 1 }, 'closed');
    expect(next.days[D(1)].goals[0].source?.state).toBe('closed');
    expect(next.days[D(2)].goals[0]).toMatchObject({ status: 'todo' });
    expect(d.days[D(1)].goals[0].source?.state).toBe('open'); // original untouched
  });
  it('setIssueState can be limited to one day so history keeps its old snapshot', () => {
    let d = freshData();
    d = withDay(d, D(1), (day) => addIssueItem(day, src(1, 'open'), 'A', NOW));
    d = withDay(d, D(2), (day) => addIssueItem(day, src(1, 'open'), 'A', NOW));
    const next = setIssueState(d, { repo: 'o/r', number: 1 }, 'closed', D(2));
    expect(next.days[D(2)].goals[0].source?.state).toBe('closed');
    expect(next.days[D(1)]).toBe(d.days[D(1)]);
    expect(setIssueState(next, { repo: 'o/r', number: 1 }, 'closed', D(2))).toBe(next);
  });
  it('moveWithinKind reorders inside one list and skips the other kind', () => {
    let day = emptyDay(D(1));
    day = addGoal(day, 'own A', NOW);
    day = addIssueItem(day, src(1), 'issue 1', NOW);
    day = addGoal(day, 'own B', NOW);
    day = addIssueItem(day, src(2), 'issue 2', NOW);
    const id = (t: string) => day.goals.find((g) => g.title === t)!.id;
    const titles = (x: Day) => x.goals.map((g) => g.title);
    expect(titles(moveWithinKind(day, id('own B'), -1))).toEqual(['own B', 'issue 1', 'own A', 'issue 2']);
    expect(titles(moveWithinKind(day, id('issue 2'), -1))).toEqual(['own A', 'issue 2', 'own B', 'issue 1']);
    expect(moveWithinKind(day, id('own A'), -1)).toBe(day); // already first of its kind
    expect(moveWithinKind(day, id('issue 2'), 1)).toBe(day); // already last of its kind
  });
  it('carry-over keeps the issue link and kind', () => {
    let d = freshData();
    d = withDay(d, D(1), (day) => addIssueItem(day, src(9), 'Carry me', NOW));
    const id = d.days[D(1)].goals[0].id;
    d = carryOver(d, D(2), D(1), [id], NOW);
    expect(d.days[D(2)].goals[0]).toMatchObject({ kind: 'issue', carriedFrom: D(1) });
    expect(d.days[D(2)].goals[0].source?.number).toBe(9);
  });

  describe('migration from v2', () => {
    const v2 = () => {
      const d = makeSampleData(NOW);
      const days = JSON.parse(JSON.stringify(d.days)) as AppData['days'];
      for (const day of Object.values(days)) for (const g of day.goals as unknown as Record<string, unknown>[]) delete g.kind;
      const first = Object.values(days)[0];
      first.goals[0] = { ...first.goals[0], source: src(3) };
      return { ...d, version: 2, days } as unknown as AppData;
    };
    it('adds kind from source and keeps everything else', () => {
      const m = migrateData(v2())!;
      expect(m.version).toBe(3);
      const first = Object.values(m.days)[0];
      expect(first.goals[0].kind).toBe('issue');
      expect(first.goals[1].kind).toBe('own');
      expect(migrateData({ ...v2(), version: 1 })).toBeNull();
    });
    it('loads v2 browser data, keeps an untouched backup, and imports v2 backups', () => {
      const m = new Map<string, string>();
      const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
      const raw = JSON.stringify(v2());
      st.setItem('dailyquest.data', raw);
      const r = loadData(st);
      expect(r.status).toBe('ok');
      expect(r.data?.version).toBe(3);
      expect(m.get(V2_BACKUP_KEY)).toBe(raw);
      expect(parseBackup(raw)?.version).toBe(3);
    });
    it('rejects v3 data whose kind disagrees with source', () => {
      const d = makeSampleData(NOW);
      const day = Object.values(d.days)[0];
      day.goals[0] = { ...day.goals[0], kind: 'issue' }; // issue without a source
      expect(migrateData(d)).toBeNull();
    });
    it('reads a v2 parquet folder and upgrades it to items files on the next write', async () => {
      const dir = (() => {
        const files = new Map<string, ArrayBuffer>();
        return { files, list: async () => [...files.keys()], read: async (n: string) => files.get(n) ?? null, write: async (n: string, b: ArrayBuffer) => void files.set(n, b), remove: async (n: string) => void files.delete(n) };
      })();
      // Build a v3 folder, then rewrite it the way v2 stored it.
      const d = withDay(makeSampleData(NOW), D(1), (day) => addIssueItem(day, src(4, 'open'), 'Legacy issue', NOW));
      await writeFolder(dir, d, new Map());
      const old = new Map<string, ArrayBuffer>();
      const { parquetWriteBuffer } = await import('hyparquet-writer');
      for (const [name, buf] of dir.files) {
        if (name === 'meta.parquet') {
          old.set(name, parquetWriteBuffer({ columnData: [
            { name: 'version', type: 'INT32', data: [2] }, { name: 'displayName', type: 'STRING', data: [''] },
            { name: 'goalsSoftLimit', type: 'INT32', data: [5] }, { name: 'sampleLoaded', type: 'BOOLEAN', data: [false] },
          ] }));
        } else if (name.endsWith('.items.parquet')) {
          const { parquetReadObjects } = await import('hyparquet');
          const rows = (await parquetReadObjects({ file: buf })) as Record<string, unknown>[];
          const col = (k: string, type: 'STRING' | 'INT32' | 'INT64' | 'BOOLEAN', f: (r: Record<string, unknown>) => unknown) => ({ name: k, type, nullable: true, data: rows.map(f) as never });
          old.set(name.replace('.items.', '.goals.'), parquetWriteBuffer({ columnData: [
            col('date', 'STRING', (r) => r.date), col('position', 'INT32', (r) => r.position), col('id', 'STRING', (r) => r.id),
            col('title', 'STRING', (r) => r.title), col('note', 'STRING', (r) => r.note), col('status', 'STRING', (r) => r.status),
            col('focus', 'BOOLEAN', (r) => r.focus), col('createdAt', 'INT64', (r) => r.createdAt), col('doneAt', 'INT64', (r) => r.doneAt),
            col('carriedFrom', 'STRING', (r) => r.carriedFrom), col('carried', 'BOOLEAN', (r) => r.carried),
            col('sourceRepo', 'STRING', (r) => r.repo), col('sourceNumber', 'INT32', (r) => r.number), col('sourceUrl', 'STRING', (r) => r.url),
          ] }));
        } else old.set(name, buf);
      }
      dir.files.clear();
      for (const [n, b] of old) dir.files.set(n, b);

      const r = await inspectFolder(dir);
      expect(r.status).toBe('ok');
      if (r.status !== 'ok') return;
      expect(r.data.version).toBe(3);
      const legacy = Object.values(r.data.days).flatMap((day) => day.goals).find((g) => g.title === 'Legacy issue');
      expect(legacy).toMatchObject({ kind: 'issue' });
      expect(legacy?.source?.number).toBe(4);

      await writeFolder(dir, r.data, new Map());
      const names = [...dir.files.keys()];
      expect(names.some((n) => n.endsWith('.goals.parquet'))).toBe(false);
      expect(names.some((n) => n.endsWith('.items.parquet'))).toBe(true);
    });
  });
});

describe('folder storage (parquet)', () => {
  const memDir = (): Dir & { files: Map<string, ArrayBuffer>; writes: string[] } => {
    const files = new Map<string, ArrayBuffer>();
    const writes: string[] = [];
    return {
      files,
      writes,
      list: async () => [...files.keys()],
      read: async (n) => files.get(n) ?? null,
      write: async (n, b) => void (writes.push(n), files.set(n, b)),
      remove: async (n) => void files.delete(n),
    };
  };
  const sample = (): AppData => {
    let d = makeSampleData(NOW);
    d = withDay(d, '2026-05-31', (day) => {
      day = addGoal(day, 'From GitHub — "quoted", ünïcode ✓', NOW);
      day.goals[0] = { ...day.goals[0], kind: 'issue', source: { type: 'github', repo: 'o/r', number: 7, url: 'https://github.com/o/r/issues/7', state: 'closed' }, note: 'line1\nline2' };
      return { ...day, win: 'a win', reflection: '', highlights: [{ ...prHighlight({ number: 3, title: 'PR', url: 'https://github.com/o/r/pull/3', mergedAt: new Date(NOW).toISOString(), repo: 'o/r' }), id: 'h-1' }] };
    });
    return { ...d, settings: { displayName: 'Jez', goalsSoftLimit: 4 } };
  };
  const strip = (d: AppData) => ({ ...d, savedAt: undefined });

  it('round-trips every field, including nulls, unicode and several months', async () => {
    const d = sample();
    const dir = memDir();
    await writeFolder(dir, d, new Map(), 123);
    expect([...dir.files.keys()]).toContain('2026-05.days.parquet');
    expect([...dir.files.keys()]).toContain('2026-06.days.parquet');
    const r = await inspectFolder(dir);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.data.savedAt).toBe(123);
      expect(strip(r.data)).toEqual(strip(d));
    }
  });
  it('an empty folder is empty, and an empty app round-trips', async () => {
    const dir = memDir();
    expect((await inspectFolder(dir)).status).toBe('empty');
    await writeFolder(dir, freshData(), new Map());
    const r = await inspectFolder(dir);
    expect(r.status).toBe('ok');
  });
  it('only rewrites months that changed', async () => {
    const d = sample();
    const dir = memDir();
    const cache = new Map();
    await writeFolder(dir, d, cache);
    dir.writes.length = 0;
    const changed = withDay(d, '2026-06-10', (day) => ({ ...day, win: 'edited' }));
    await writeFolder(dir, changed, cache);
    expect(dir.writes.filter((n) => n.startsWith('2026-05'))).toEqual([]);
    expect(dir.writes).toContain('2026-06.days.parquet');
  });
  it('removes files for erased months and leaves other files alone', async () => {
    const dir = memDir();
    await writeFolder(dir, sample(), new Map());
    dir.files.set('notes.txt', new ArrayBuffer(1));
    await writeFolder(dir, freshData(), new Map());
    expect([...dir.files.keys()].sort()).toEqual(['meta.parquet', 'notes.txt']);
  });
  it('unreadable or newer folders are reported, never overwritten', async () => {
    const dir = memDir();
    await writeFolder(dir, sample(), new Map());
    dir.files.set('2026-06.days.parquet', new Uint8Array([1, 2, 3]).buffer);
    const bad = await inspectFolder(dir);
    expect(bad.status).toBe('unreadable');
    const noMeta = memDir();
    await writeFolder(noMeta, sample(), new Map());
    noMeta.files.delete('meta.parquet');
    expect((await inspectFolder(noMeta)).status).toBe('unreadable');
    const newer = memDir();
    await writeFolder(newer, { ...freshData(), version: 99 }, new Map());
    const r = await inspectFolder(newer);
    expect(r.status === 'unreadable' && /newer version/.test(r.message)).toBe(true);
  });
});

describe('github', () => {
  it('config: missing, placeholders, invalid, old single-repo shape', () => {
    expect(parseConfig(null).status).toBe('missing');
    expect(parseConfig({ github: { repos: ['YOUR_OWNER/YOUR_REPO'] } }).status).toBe('missing');
    expect(parseConfig({ github: { repos: ['bad'] } }).status).toBe('invalid');
    expect(parseConfig({ github: { repos: ['a/b'], apiBaseUrl: 'http://x' } }).status).toBe('invalid');
    const old = parseConfig({ github: { owner: 'a', repo: 'b' } });
    expect(old.status === 'ok' && old.config.repos).toEqual([{ owner: 'a', name: 'b' }]);
    const ok = parseConfig({ github: { username: 'me', repos: ['a/b', 'c/d'], token: 'YOUR_READ_ONLY_TOKEN' } });
    expect(ok.status === 'ok' && ok.config.token).toBe('');
  });

  const cfg = (extra = {}) => {
    const r = parseConfig({ github: { username: 'me', repos: ['a/b'], token: 'secret', ...extra } });
    if (r.status !== 'ok') throw new Error('bad config');
    return r.config;
  };
  const SINCE = new Date('2026-06-10T00:00:00Z').getTime();
  const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

  it('reads assigned, closed today, merged PRs and commits — GET only, token in header only', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const act = await fetchActivity(
      cfg(),
      SINCE,
      async (url, init) => {
        calls.push({ url, init });
        if (url.includes('/issues?') && url.includes('state=open'))
          return res([{ number: 1, title: 'Open', html_url: 'https://g/1', labels: [{ name: 'bug' }] }, { number: 2, title: 'PR', pull_request: {} }]);
        if (url.includes('/issues?'))
          return res([
            { number: 3, title: 'Closed today', html_url: 'https://g/3', closed_at: '2026-06-10T08:00:00Z' },
            { number: 4, title: 'Closed earlier', html_url: 'https://g/4', closed_at: '2026-06-01T08:00:00Z' },
          ]);
        if (url.includes('/pulls?'))
          return res([
            { number: 5, title: 'Mine', html_url: 'https://g/5', merged_at: '2026-06-10T09:00:00Z', user: { login: 'Me' } },
            { number: 6, title: 'Not mine', html_url: 'https://g/6', merged_at: '2026-06-10T09:00:00Z', user: { login: 'other' } },
            { number: 7, title: 'Old', html_url: 'https://g/7', merged_at: '2026-05-01T09:00:00Z', user: { login: 'me' } },
            { number: 8, title: 'Closed unmerged', html_url: 'https://g/8', merged_at: null, user: { login: 'me' } },
          ]);
        if (url.includes('/commits?'))
          return res([{ sha: 'abc1234', html_url: 'https://g/c', commit: { message: 'Fix thing\n\nbody', author: { date: '2026-06-10T10:00:00Z' } } }]);
        return res([], 404);
      },
    );
    expect(act.assigned.map((i) => i.number)).toEqual([1]);
    expect(act.closed.map((i) => i.number)).toEqual([3]);
    expect(act.prs.map((p) => p.number)).toEqual([5]);
    expect(act.commits[0].title).toBe('Fix thing');
    expect(calls.every((c) => (c.init?.method ?? 'GET') === 'GET')).toBe(true);
    expect(calls.every((c) => !c.url.includes('secret'))).toBe(true);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it('keeps going when one repo fails and reports a friendly error', async () => {
    const act = await fetchActivity(cfg({ repos: ['a/b', 'c/d'] }), SINCE, async (url) => {
      if (url.includes('/repos/c/d')) return res({}, 404);
      return res([]);
    });
    expect(act.errors.join(' ')).toMatch(/not found/);
  });

  it('resolves the username from the token when not configured', async () => {
    let asked = '';
    const act = await fetchActivity(cfg({ username: '' }), SINCE, async (url) => {
      if (url.endsWith('/user')) return res({ login: 'lookedup' });
      asked += url;
      return res([]);
    });
    expect(act.username).toBe('lookedup');
    expect(asked).toContain('assignee=lookedup');
  });

  it('only allows http(s) links', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('https://github.com/x')).not.toBeNull();
  });
});
