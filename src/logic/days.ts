import type { AppData, Day, Goal, GoalSource, GoalStatus, Highlight } from '../types';
import { addDays, uid } from './util';

export const emptyDay = (date: string): Day => ({
  date,
  focusNote: '',
  goals: [],
  highlights: [],
  win: '',
  reflection: '',
  tomorrow: '',
  carryDismissed: false,
});

export const getDay = (d: Pick<AppData, 'days'>, date: string): Day => d.days[date] ?? emptyDay(date);

export function putDay(d: AppData, day: Day): AppData {
  return { ...d, days: { ...d.days, [day.date]: day } };
}

const clean = (s: string) => s.trim();

// ---------- goals ----------

export function newGoal(title: string, now: number, extra: Partial<Goal> = {}): Goal {
  return { id: uid(), title: clean(title), note: '', status: 'todo', focus: false, createdAt: now, doneAt: null, ...extra };
}

export function addGoal(day: Day, title: string, now: number, extra: Partial<Goal> = {}): Day {
  if (!clean(title)) return day;
  return { ...day, goals: [...day.goals, newGoal(title, now, extra)] };
}

export function updateGoal(day: Day, id: string, patch: Partial<Goal>): Day {
  return { ...day, goals: day.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) };
}

/** Status is always set explicitly by the user — never inferred. */
export function setGoalStatus(day: Day, id: string, status: GoalStatus, now: number): Day {
  return updateGoal(day, id, { status, doneAt: status === 'done' ? now : null });
}

export function removeGoal(day: Day, id: string): Day {
  return { ...day, goals: day.goals.filter((g) => g.id !== id) };
}

/** Only one goal can be the focus goal. Clicking it again clears the focus. */
export function toggleFocus(day: Day, id: string): Day {
  const target = day.goals.find((g) => g.id === id);
  if (!target) return day;
  const on = !target.focus;
  return { ...day, goals: day.goals.map((g) => ({ ...g, focus: g.id === id ? on : false })) };
}

export function moveGoal(day: Day, id: string, dir: -1 | 1): Day {
  const i = day.goals.findIndex((g) => g.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= day.goals.length) return day;
  const goals = [...day.goals];
  [goals[i], goals[j]] = [goals[j], goals[i]];
  return { ...day, goals };
}

export const isUnfinished = (g: Goal) => g.status === 'todo' || g.status === 'in-progress';

export function hasSource(day: Day, s: Pick<GoalSource, 'repo' | 'number'>): boolean {
  return day.goals.some((g) => g.source && g.source.repo === s.repo && g.source.number === s.number);
}

// ---------- carry over ----------

/** Unfinished goals from the most recent earlier day that have not been carried yet. */
export function carryCandidates(d: AppData, date: string): { from: string; goals: Goal[] } | null {
  const past = Object.keys(d.days)
    .filter((k) => k < date)
    .sort()
    .reverse();
  for (const k of past) {
    const goals = d.days[k].goals.filter((g) => isUnfinished(g) && !g.carried);
    if (goals.length > 0) return { from: k, goals };
    // only look at the latest day that has any goals at all
    if (d.days[k].goals.length > 0) return null;
  }
  return null;
}

export function carryOver(d: AppData, date: string, from: string, ids: string[], now: number): AppData {
  const src = getDay(d, from);
  let target = getDay(d, date);
  const picked = src.goals.filter((g) => ids.includes(g.id) && isUnfinished(g) && !g.carried);
  for (const g of picked) {
    target = addGoal(target, g.title, now, { note: g.note, source: g.source, carriedFrom: from, status: 'todo' });
  }
  const marked: Day = { ...src, goals: src.goals.map((g) => (picked.some((p) => p.id === g.id) ? { ...g, carried: true } : g)) };
  return { ...d, days: { ...d.days, [from]: marked, [date]: target } };
}

export function dismissCarry(day: Day): Day {
  return { ...day, carryDismissed: true };
}

// ---------- highlights ----------

export function highlightKey(h: Pick<Highlight, 'kind' | 'repo'>, ref: string | number) {
  return `${h.kind}:${h.repo}:${ref}`;
}

export function isPinned(day: Day, key: string) {
  return day.highlights.some((h) => h.key === key);
}

export function togglePin(day: Day, h: Omit<Highlight, 'id'>): Day {
  if (isPinned(day, h.key)) return { ...day, highlights: day.highlights.filter((x) => x.key !== h.key) };
  return { ...day, highlights: [...day.highlights, { ...h, id: uid() }] };
}

// ---------- stats ----------

export interface DayStats {
  total: number;
  done: number;
  inProgress: number;
  skipped: number;
  open: number;
  percent: number;
  allDone: boolean;
}

export function dayStats(day: Day): DayStats {
  const counted = day.goals.filter((g) => g.status !== 'skipped');
  const done = counted.filter((g) => g.status === 'done').length;
  return {
    total: day.goals.length,
    done,
    inProgress: day.goals.filter((g) => g.status === 'in-progress').length,
    skipped: day.goals.filter((g) => g.status === 'skipped').length,
    open: day.goals.filter(isUnfinished).length,
    percent: counted.length === 0 ? 0 : Math.round((done / counted.length) * 100),
    allDone: counted.length > 0 && done === counted.length,
  };
}

/** A day is "active" when the user recorded something done or highlighted. */
export const isActiveDay = (day: Day | undefined): boolean =>
  !!day && (day.goals.some((g) => g.status === 'done') || day.highlights.length > 0);

/** Consecutive active days ending today — or yesterday, so a quiet morning never shows a broken streak. */
export function currentStreak(d: Pick<AppData, 'days'>, today: string): number {
  let cursor = isActiveDay(d.days[today]) ? today : addDays(today, -1);
  let n = 0;
  while (isActiveDay(d.days[cursor])) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** Everything done on a day: completed goals + pinned GitHub highlights. */
export function doneItems(day: Day) {
  return {
    goals: day.goals.filter((g) => g.status === 'done'),
    highlights: day.highlights,
  };
}

export function totalGoalsDone(d: Pick<AppData, 'days'>): number {
  return Object.values(d.days).reduce((n, day) => n + day.goals.filter((g) => g.status === 'done').length, 0);
}
