import type { AppData, Day, Goal } from '../types';
import { freshData } from './storage';
import { emptyDay, newGoal } from './days';
import { addDays, toISODate } from './util';

/** Clearly-labelled sample week so the UI can be explored. Loaded only on request. */
export function makeSampleData(now = Date.now()): AppData {
  const today = toISODate(now);
  const days: Record<string, Day> = {};
  const g = (title: string, status: Goal['status'], extra: Partial<Goal> = {}): Goal => ({
    ...newGoal(title, now, extra),
    status,
    doneAt: status === 'done' ? now : null,
  });
  const build = (offset: number, goals: Goal[], extra: Partial<Day> = {}) => {
    const date = addDays(today, offset);
    days[date] = { ...emptyDay(date), goals, ...extra };
  };
  build(-4, [g('Plan the week', 'done'), g('Review open pull requests', 'done'), g('Write release notes', 'skipped')], { win: 'Got the week planned in 20 minutes.' });
  build(-3, [g('Fix login redirect bug', 'done', { focus: true }), g('Reply to design feedback', 'done'), g('Update README', 'done')], {
    reflection: 'Pairing helped a lot.',
    highlights: [{ id: 's1', key: 'pr-merged:sample/app:41', kind: 'pr-merged', title: 'Fix login redirect (sample)', url: 'https://example.com/pr/41', repo: 'sample/app', at: now }],
  });
  build(-2, [g('Draft onboarding checklist', 'done', { focus: true }), g('Refactor settings page', 'in-progress')]);
  build(-1, [g('Finish settings refactor', 'done', { focus: true, carriedFrom: addDays(today, -2) }), g('Triage new issues', 'done'), g('Gym', 'todo')], {
    win: 'Settings refactor is finally merged.',
    highlights: [{ id: 's2', key: 'commit:sample/app:abc123', kind: 'commit', title: 'Refactor settings (sample)', url: 'https://example.com/commit/abc123', repo: 'sample/app', at: now }],
  });
  build(0, [g('Ship the dashboard tweaks', 'in-progress', { focus: true }), g('Write tests for goals list', 'todo'), g('Reply to emails', 'done')], {
    focusNote: 'Keep it small and finish one thing properly.',
  });
  return { ...freshData(), days, sampleLoaded: true };
}
