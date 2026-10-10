import type { Day, Goal, HighlightKind } from '../types';
import { dayStats, doneItems, isUnfinished } from './days';
import { formatDate, formatShortDate } from './util';

export const KIND_LABEL: Record<HighlightKind, string> = {
  'issue-closed': 'Issue closed',
  'pr-merged': 'PR merged',
  commit: 'Commit',
};

const goalLine = (g: Goal) => {
  const src = g.source ? ` (${g.source.repo}#${g.source.number} ${g.source.url})` : '';
  const note = g.note.trim() ? ` — ${g.note.trim()}` : '';
  return `- ${g.title}${g.focus ? ' ★ focus' : ''}${note}${src}`;
};

/** Plain-text / Markdown summary of one day. Empty sections are labelled, never invented. */
export function buildDaySummary(day: Day, name = ''): string {
  const L: string[] = [];
  const s = dayStats(day);
  L.push(`DAILY QUEST — ${name.trim() ? `${name.trim().toUpperCase()}'S DAY` : 'MY DAY'}`);
  L.push(`Date: ${formatDate(day.date)}`);
  if (day.focusNote.trim()) L.push(`Intention: ${day.focusNote.trim()}`);
  L.push('');

  const { goals, highlights } = doneItems(day);
  L.push('DONE TODAY');
  if (goals.length === 0 && highlights.length === 0) L.push('- Nothing recorded yet.');
  goals.forEach((g) => L.push(goalLine(g)));
  highlights.forEach((h) => L.push(`- [${KIND_LABEL[h.kind]}] ${h.title} (${h.repo}) ${h.url}`));
  L.push('');

  const open = day.goals.filter(isUnfinished);
  if (open.length > 0) {
    L.push('STILL OPEN');
    open.forEach((g) => L.push(`${goalLine(g)} [${g.status === 'in-progress' ? 'in progress' : 'not started'}]`));
    L.push('');
  }
  const skipped = day.goals.filter((g) => g.status === 'skipped');
  if (skipped.length > 0) {
    L.push('SKIPPED');
    skipped.forEach((g) => L.push(`- ${g.title}`));
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
  L.push(`- Goals done: ${s.done} of ${s.total - s.skipped}${s.skipped ? ` (${s.skipped} skipped)` : ''}`);
  L.push(`- GitHub highlights: ${highlights.length}`);
  return L.join('\n');
}

export function buildWeekSummary(days: Day[], name = ''): string {
  const L: string[] = [`DAILY QUEST — ${name.trim() ? `${name.trim().toUpperCase()}'S` : 'MY'} WEEK`, ''];
  let totalDone = 0;
  let totalHl = 0;
  for (const day of days) {
    const { goals, highlights } = doneItems(day);
    totalDone += goals.length;
    totalHl += highlights.length;
    L.push(formatShortDate(day.date).toUpperCase());
    if (goals.length === 0 && highlights.length === 0) L.push('- Nothing recorded.');
    goals.forEach((g) => L.push(`- ${g.title}${g.source ? ` (${g.source.repo}#${g.source.number})` : ''}`));
    highlights.forEach((h) => L.push(`- [${KIND_LABEL[h.kind]}] ${h.title} (${h.repo})`));
    if (day.win.trim()) L.push(`- Win: ${day.win.trim()}`);
    L.push('');
  }
  L.push('TOTALS');
  L.push(`- Goals done: ${totalDone}`);
  L.push(`- GitHub highlights: ${totalHl}`);
  return L.join('\n');
}

export function summaryFileName(date: string): string {
  return `daily-quest-${date}.md`;
}
