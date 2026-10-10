import type { AchievementDef, AchievementId, AppData } from '../types';
import { isActiveDay, dayStats } from './days';
import { addDays } from './util';

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-goal', name: 'First Step', description: 'You completed your first goal.', criteria: 'Mark any goal done.' },
  { id: 'clean-sweep', name: 'Clean Sweep', description: 'Every goal for the day was done.', criteria: 'Finish a day with 3 or more goals, all done (skipped goals do not count against you).' },
  { id: 'steady-3', name: 'Steady Three', description: 'Three active days in a row.', criteria: 'Three consecutive days with a goal done or a highlight.' },
  { id: 'steady-7', name: 'Full Week', description: 'Seven active days in a row.', criteria: 'Seven consecutive days with a goal done or a highlight.' },
  { id: 'focus-finisher', name: 'Focus Finisher', description: 'You finished your focus goal on 3 different days.', criteria: 'Mark your focus goal done on 3 days.' },
  { id: 'shipper', name: 'Shipper', description: 'You highlighted a merged pull request.', criteria: 'Highlight a merged PR from GitHub.' },
  { id: 'issue-closer', name: 'Issue Closer', description: 'You finished a goal tied to a GitHub issue, or highlighted a closed issue.', criteria: 'Complete a goal linked to a GitHub issue, or highlight a closed issue.' },
  { id: 'reflective', name: 'Reflective', description: 'You wrote a reflection on 5 days.', criteria: 'Write a reflection or a win on 5 different days.' },
];

export function achievementDef(id: AchievementId): AchievementDef {
  return ACHIEVEMENTS.find((a) => a.id === id) as AchievementDef;
}

export interface Earned {
  id: AchievementId;
  date: string; // day on which it was first earned
  progress: string;
}

/** Computed purely from saved days — nothing is awarded unless the records show it. */
export function evaluateAchievements(d: Pick<AppData, 'days'>): Earned[] {
  const dates = Object.keys(d.days).sort();
  const first: Partial<Record<AchievementId, string>> = {};
  const mark = (id: AchievementId, date: string) => {
    if (!first[id]) first[id] = date;
  };

  let run = 0;
  let prev: string | null = null;
  let focusDays = 0;
  let reflectDays = 0;

  for (const date of dates) {
    const day = d.days[date];
    const s = dayStats(day);
    if (day.goals.some((g) => g.status === 'done')) mark('first-goal', date);
    if (s.done >= 3 && s.allDone) mark('clean-sweep', date);
    if (day.goals.some((g) => g.focus && g.status === 'done')) {
      focusDays++;
      if (focusDays >= 3) mark('focus-finisher', date);
    }
    if (day.highlights.some((h) => h.kind === 'pr-merged')) mark('shipper', date);
    if (day.highlights.some((h) => h.kind === 'issue-closed') || day.goals.some((g) => g.status === 'done' && g.source)) {
      mark('issue-closer', date);
    }
    if (day.reflection.trim() || day.win.trim()) {
      reflectDays++;
      if (reflectDays >= 5) mark('reflective', date);
    }
    if (isActiveDay(day)) {
      run = prev && addDays(prev, 1) === date ? run + 1 : 1;
      prev = date;
      if (run >= 3) mark('steady-3', date);
      if (run >= 7) mark('steady-7', date);
    }
  }

  const progress: Partial<Record<AchievementId, string>> = {
    'focus-finisher': `${focusDays} of 3 focus days`,
    reflective: `${reflectDays} of 5 days`,
  };
  return ACHIEVEMENTS.filter((a) => first[a.id]).map((a) => ({
    id: a.id,
    date: first[a.id] as string,
    progress: progress[a.id] ?? '',
  }));
}

export function progressFor(d: Pick<AppData, 'days'>, id: AchievementId): string {
  const days = Object.values(d.days);
  if (id === 'focus-finisher') return `${days.filter((x) => x.goals.some((g) => g.focus && g.status === 'done')).length} of 3 focus days`;
  if (id === 'reflective') return `${days.filter((x) => x.reflection.trim() || x.win.trim()).length} of 5 days`;
  return '';
}
