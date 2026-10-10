export type GoalStatus = 'todo' | 'in-progress' | 'done' | 'skipped';

export interface GoalSource {
  type: 'github';
  repo: string; // owner/name
  number: number;
  url: string;
}

export interface Goal {
  id: string;
  title: string;
  note: string;
  status: GoalStatus;
  focus: boolean; // the one most important goal of the day
  source?: GoalSource;
  carriedFrom?: string; // ISO date of the day it was carried over from
  carried?: boolean; // true on the original once it has been carried to a later day
  createdAt: number;
  doneAt: number | null;
}

export type HighlightKind = 'issue-closed' | 'pr-merged' | 'commit';

export interface Highlight {
  id: string;
  key: string; // `${kind}:${repo}:${ref}` — prevents pinning the same item twice
  kind: HighlightKind;
  title: string;
  url: string;
  repo: string;
  at: number;
}

export interface Day {
  date: string; // YYYY-MM-DD (local)
  focusNote: string; // today's intention
  goals: Goal[];
  highlights: Highlight[];
  win: string; // best thing about today
  reflection: string; // what happened / learned
  tomorrow: string; // notes for tomorrow
  carryDismissed: boolean;
}

export interface Settings {
  displayName: string;
  goalsSoftLimit: number; // gentle prompt when exceeded
}

export interface AppData {
  version: number;
  days: Record<string, Day>;
  settings: Settings;
  sampleLoaded: boolean;
  savedAt?: number;
}

export type AchievementId =
  | 'first-goal'
  | 'clean-sweep'
  | 'steady-3'
  | 'steady-7'
  | 'focus-finisher'
  | 'shipper'
  | 'issue-closer'
  | 'reflective';

export interface AchievementDef {
  id: AchievementId;
  name: string;
  description: string;
  criteria: string;
}
