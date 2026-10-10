import { describe, expect, it } from 'vitest';
import type { AppData, Day } from '../types';
import {
  addGoal,
  carryCandidates,
  carryOver,
  currentStreak,
  dayStats,
  emptyDay,
  moveGoal,
  putDay,
  removeGoal,
  setGoalStatus,
  togglePin,
  toggleFocus,
} from './days';
import { evaluateAchievements } from './achievements';
import { buildDaySummary, buildWeekSummary } from './summary';
import { BACKUP_KEY, V1_BACKUP_KEY, freshData, loadData, parseBackup, saveData } from './storage';
import {
  commitHighlight,
  fetchActivity,
  parseConfig,
  prHighlight,
  safeUrl,
} from './github';
import { makeSampleData } from './sample';

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
    expect(buildDaySummary(emptyDay(D(1)))).toContain('- Nothing recorded yet.');
    let day = addGoal(addGoal(emptyDay(D(1)), 'Ship it', NOW, { source: { type: 'github', repo: 'a/b', number: 9, url: 'https://x/9' } }), 'Open one', NOW);
    day = setGoalStatus(day, day.goals[0].id, 'done', NOW);
    day = { ...day, win: 'Nice' };
    const t = buildDaySummary(day, 'Sam');
    expect(t).toContain("SAM'S DAY");
    expect(t).toContain('- Ship it (a/b#9 https://x/9)');
    expect(t).toContain('STILL OPEN');
    expect(t).toContain('- Open one [not started]');
    expect(t).toContain('Win: Nice');
    expect(t).toContain('Goals done: 1 of 2');
    expect(t).not.toContain('FOR TOMORROW');
  });
  it('week summary totals', () => {
    const d = done(freshData(), D(1), ['a', 'b']);
    expect(buildWeekSummary([d.days[D(1)], emptyDay(D(2))])).toContain('- Goals done: 2');
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
