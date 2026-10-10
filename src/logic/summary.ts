import type { Day, Goal, GoalSource, GoalStatus, HighlightKind } from '../types';
import { dayStats, doneItems, issueIndex, issueLog } from './days';
import type { IssueLogEntry } from './days';
import { formatDate, formatShortDate } from './util';

export const KIND_LABEL: Record<HighlightKind, string> = {
  'issue-closed': 'Issue closed',
  'pr-merged': 'PR merged',
  commit: 'Commit',
};

const STATUS_TEXT: Record<GoalStatus, string> = {
  todo: 'not started',
  'in-progress': 'in progress',
  done: 'done',
  skipped: 'skipped',
};

const issueRef = (s: Pick<GoalSource, 'repo' | 'number'>) => `${s.repo}#${s.number}`;

/** A note can span lines; keep every line indented under its bullet. */
const noteLines = (note: string, indent: string): string[] =>
  note.trim() ? note.trim().split('\n').map((l, i) => `${indent}${i === 0 ? 'Note: ' : '      '}${l.trim()}`) : [];

/** Plain-text / Markdown summary of one day: issues first, then other work, then reflection. Empty sections are labelled, never invented. */
export function buildDaySummary(day: Day, name = ''): string {
  const L: string[] = [];
  const s = dayStats(day);
  L.push(`DAILY QUEST — ${name.trim() ? `${name.trim().toUpperCase()}'S DAY` : 'MY DAY'}`);
  L.push(`Date: ${formatDate(day.date)}`);
  if (day.focusNote.trim()) L.push(`Intention: ${day.focusNote.trim()}`);
  L.push('');

  const issues = day.goals.filter((g) => g.kind === 'issue' && g.source);
  L.push('ISSUES');
  if (issues.length === 0) L.push('- No issues on this day.');
  for (const g of issues as (Goal & { source: GoalSource })[]) {
    L.push(`- [${STATUS_TEXT[g.status]}] ${issueRef(g.source)} ${g.title}${g.focus ? ' ★ focus' : ''}`);
    L.push(`  ${g.source.url}`);
    L.push(...noteLines(g.note, '  '));
  }
  L.push('');

  const own = day.goals.filter((g) => g.kind !== 'issue');
  if (own.length > 0) {
    L.push('NOT ON GITHUB');
    for (const g of own) {
      L.push(`- [${STATUS_TEXT[g.status]}] ${g.title}${g.focus ? ' ★ focus' : ''}`);
      L.push(...noteLines(g.note, '  '));
    }
    L.push('');
  }

  const { highlights } = doneItems(day);
  if (highlights.length > 0) {
    L.push('GITHUB ACTIVITY');
    highlights.forEach((h) => L.push(`- [${KIND_LABEL[h.kind]}] ${h.title} (${h.repo}) ${h.url}`));
    L.push('');
  }

  if (day.win.trim() || day.reflection.trim()) {
    L.push('REFLECTION');
    if (day.win.trim()) L.push(`- Win: ${day.win.trim()}`);
    if (day.reflection.trim()) L.push(`- Notes: ${day.reflection.trim()}`);
    L.push('');
  }
  if (day.tomorrow.trim()) {
    L.push('FOR TOMORROW');
    L.push(`- ${day.tomorrow.trim()}`);
    L.push('');
  }

  L.push('RESULTS');
  L.push(`- Done: ${s.done} of ${s.total - s.skipped}${s.skipped ? ` (${s.skipped} skipped)` : ''}`);
  L.push(`- Issues on this day: ${issues.length}`);
  L.push(`- GitHub highlights: ${highlights.length}`);
  return L.join('\n');
}

/** A week (or any run of days): each issue with its day-by-day notes, then other work, activity and wins. */
export function buildWeekSummary(days: Day[], name = ''): string {
  const L: string[] = [`DAILY QUEST — ${name.trim() ? `${name.trim().toUpperCase()}'S` : 'MY'} WEEK`, ''];
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const index = issueIndex({ days: byDate });

  L.push('ISSUES');
  if (index.length === 0) L.push('- No issues this week.');
  for (const i of index) {
    L.push(`- ${issueRef(i.source)} ${i.title}`);
    L.push(`  ${i.source.url}`);
    for (const e of issueLog({ days: byDate }, i.source)) {
      L.push(`  - ${formatShortDate(e.date)} [${STATUS_TEXT[e.status]}]${e.note.trim() ? ` ${e.note.trim().replace(/\s*\n\s*/g, ' / ')}` : ''}`);
    }
  }
  L.push('');

  let otherDone = 0;
  let otherTotal = 0;
  const other: string[] = [];
  let highlights = 0;
  const activity: string[] = [];
  const wins: string[] = [];
  for (const day of [...days].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const g of day.goals.filter((x) => x.kind !== 'issue')) {
      otherTotal++;
      if (g.status === 'done') otherDone++;
      other.push(`- ${formatShortDate(day.date)} [${STATUS_TEXT[g.status]}] ${g.title}`);
    }
    for (const h of day.highlights) {
      highlights++;
      activity.push(`- ${formatShortDate(day.date)} [${KIND_LABEL[h.kind]}] ${h.title} (${h.repo})`);
    }
    if (day.win.trim()) wins.push(`- ${formatShortDate(day.date)}: ${day.win.trim()}`);
  }
  if (other.length) L.push('NOT ON GITHUB', ...other, '');
  if (activity.length) L.push('GITHUB ACTIVITY', ...activity, '');
  if (wins.length) L.push('WINS', ...wins, '');

  const issuesDone = index.filter((i) => i.lastStatus === 'done').length;
  L.push('TOTALS');
  L.push(`- Issues worked: ${index.length} (${issuesDone} ending the week done)`);
  L.push(`- Other items done: ${otherDone} of ${otherTotal}`);
  L.push(`- GitHub highlights: ${highlights}`);
  return L.join('\n');
}

/** The full history of one issue: every day it was on, with that day's status and note. */
export function buildIssueLog(source: GoalSource, title: string, log: IssueLogEntry[]): string {
  const L: string[] = [`${issueRef(source)} ${title}`, source.url, ''];
  if (log.length === 0) L.push('- Never on a day yet.');
  for (const e of log) {
    L.push(`${formatDate(e.date)} [${STATUS_TEXT[e.status]}]${e.carriedFrom ? ' (carried over)' : ''}`);
    const n = noteLines(e.note, '  ');
    L.push(...(n.length ? n : ['  (no note)']));
  }
  return L.join('\n');
}

export function summaryFileName(date: string): string {
  return `daily-quest-${date}.md`;
}
