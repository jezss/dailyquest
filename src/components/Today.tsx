import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Flame,
  GitCommit,
  GitMerge,
  CircleDot,
  Pencil,
  Plus,
  Sparkles,
  Star,
  StickyNote,
  Target,
  Trash2,
  Trophy,
  CheckCircle2,
} from 'lucide-react';
import type { Goal, GoalStatus } from '../types';
import { useStore } from '../store';
import { Button, Card, ConfirmDialog, Empty, Field, ProgressRing, STATUS_LABEL, copyText, downloadText } from '../ui';
import { GitHubPanel, closedLinked, useGitHub } from './GitHubPanel';
import {
  addGoal,
  carryCandidates,
  carryOver,
  currentStreak,
  dayStats,
  dismissCarry,
  doneItems,
  getDay,
  moveGoal,
  removeGoal,
  setGoalStatus,
  togglePin,
  toggleFocus,
  updateGoal,
} from '../logic/days';
import { KIND_LABEL, buildDaySummary, summaryFileName } from '../logic/summary';
import { addDays, formatDate, formatShortDate, toISODate } from '../logic/util';
import { safeUrl } from '../logic/github';
import type { View } from '../App';

const STATUSES: GoalStatus[] = ['todo', 'in-progress', 'done', 'skipped'];
const KIND_ICON = {
  'issue-closed': <CircleDot size={15} aria-hidden />,
  'pr-merged': <GitMerge size={15} aria-hidden />,
  commit: <GitCommit size={15} aria-hidden />,
};

export function Today({ date, go }: { date: string; go: (v: View) => void }) {
  const { data, update, updateDay } = useStore();
  const { state: gh } = useGitHub();
  const today = toISODate(Date.now());
  const isToday = date === today;
  const day = getDay(data, date);
  const stats = dayStats(day);
  const streak = currentStreak(data, today);
  const items = doneItems(day);
  const activity = gh.phase === 'ready' ? gh.activity : null;
  const suggestions = isToday ? closedLinked(day, activity) : [];

  const [title, setTitle] = useState('');
  const [removing, setRemoving] = useState<Goal | null>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [picked, setPicked] = useState<Set<string> | null>(null);

  const candidates = carryCandidates(data, date);
  const showCarry = !!candidates && !day.carryDismissed;
  const selected = picked ?? new Set(candidates?.goals.map((g) => g.id) ?? []);

  const edit = (fn: (d: typeof day) => typeof day) => updateDay(date, fn);
  const add = () => {
    if (!title.trim()) return;
    edit((d) => addGoal(d, title, Date.now()));
    setTitle('');
  };

  const text = buildDaySummary(day, data.settings.displayName);
  const doCopy = async () => {
    const r = await copyText(text);
    setCopy(r === 'failed' ? 'failed' : 'copied');
    if (r !== 'failed') setTimeout(() => setCopy('idle'), 2200);
  };

  const counted = day.goals.filter((g) => g.status !== 'skipped').length;
  const tooMany = counted > data.settings.goalsSoftLimit;

  return (
    <div className="stack">
      <div className="day-head">
        <div>
          <p className="eyebrow">{isToday ? 'Today' : 'Viewing a past day'}</p>
          <h1>{formatDate(date)}</h1>
        </div>
        <div className="day-nav" role="group" aria-label="Change day">
          <Button icon={<ChevronLeft size={18} aria-hidden />} onClick={() => go({ name: 'today', date: addDays(date, -1) })} aria-label="Previous day" />
          {!isToday && <Button onClick={() => go({ name: 'today' })}>Back to today</Button>}
          <Button icon={<ChevronRight size={18} aria-hidden />} disabled={date >= today} onClick={() => go({ name: 'today', date: addDays(date, 1) })} aria-label="Next day" />
        </div>
      </div>

      <div className="today-grid">
        <div className="stack">
          <Card>
            <Field
              label="Today's intention"
              value={day.focusNote}
              onChange={(v) => edit((d) => ({ ...d, focusNote: v }))}
              placeholder="What would make today a good day?"
              maxLength={160}
            />
          </Card>

          {showCarry && candidates && (
            <div className="banner info" role="region" aria-label="Unfinished goals">
              <div className="banner-body">
                <p>
                  <strong>{candidates.goals.length} unfinished goal{candidates.goals.length === 1 ? '' : 's'} from {formatShortDate(candidates.from)}.</strong> Carry any over?
                </p>
                <ul className="check-list">
                  {candidates.goals.map((g) => (
                    <li key={g.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.has(g.id)}
                          onChange={(e) => {
                            const n = new Set(selected);
                            if (e.target.checked) n.add(g.id);
                            else n.delete(g.id);
                            setPicked(n);
                          }}
                        />
                        <span>{g.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="row-end">
                  <Button onClick={() => edit(dismissCarry)}>Not now</Button>
                  <Button
                    variant="primary"
                    disabled={selected.size === 0}
                    onClick={() => {
                      update((d) => carryOver(d, date, candidates.from, [...selected], Date.now()));
                      setPicked(null);
                    }}
                  >
                    Carry over {selected.size}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="banner info" role="status">
              <div className="banner-body">
                <p><strong>Closed on GitHub</strong> — mark these goals done?</p>
                {suggestions.map((g) => (
                  <div className="row-between" key={g.id}>
                    <span>{g.title}</span>
                    <Button size="sm" variant="success" icon={<Check size={14} aria-hidden />} onClick={() => edit((d) => setGoalStatus(d, g.id, 'done', Date.now()))}>
                      Mark done
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Card title={<><Target size={20} aria-hidden /> Goals</>}>
            <form
              className="add-goal"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <label htmlFor="new-goal" className="sr-only">Add a goal</label>
              <input id="new-goal" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a goal and press Enter" maxLength={140} />
              <Button type="submit" variant="primary" icon={<Plus size={18} aria-hidden />} disabled={!title.trim()}>
                Add
              </Button>
            </form>
            {tooMany && (
              <p className="note" role="status">
                <Flame size={16} aria-hidden /> That's {counted} goals. Pick one as your focus (★) and let the rest be bonus.
              </p>
            )}
            {day.goals.length === 0 ? (
              <Empty icon={<Target size={28} aria-hidden />} title="No goals yet">
                Add the few things you want to get done {isToday ? 'today' : 'this day'}.
              </Empty>
            ) : (
              <ul className="goal-list">
                {day.goals.map((g, i) => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    first={i === 0}
                    last={i === day.goals.length - 1}
                    onStatus={(s) => edit((d) => setGoalStatus(d, g.id, s, Date.now()))}
                    onPatch={(p) => edit((d) => updateGoal(d, g.id, p))}
                    onFocus={() => edit((d) => toggleFocus(d, g.id))}
                    onMove={(dir) => edit((d) => moveGoal(d, g.id, dir))}
                    onRemove={() => setRemoving(g)}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card title={<><StickyNote size={20} aria-hidden /> End-of-day reflection</>}>
            <Field label="Today's win" value={day.win} onChange={(v) => edit((d) => ({ ...d, win: v }))} placeholder="Best thing that happened" />
            <Field label="Notes" multiline rows={3} value={day.reflection} onChange={(v) => edit((d) => ({ ...d, reflection: v }))} placeholder="What went well, what you learned, what got in the way" />
            <Field label="For tomorrow" value={day.tomorrow} onChange={(v) => edit((d) => ({ ...d, tomorrow: v }))} />
          </Card>
        </div>

        <div className="stack side-col">
          <Card className="progress-card">
            <ProgressRing done={stats.done} total={stats.total - stats.skipped} percent={stats.percent} />
            <div className="progress-meta">
              {stats.allDone && stats.done > 0 ? (
                <p className="sweep"><Trophy size={18} aria-hidden /> All goals done. Nicely finished!</p>
              ) : (
                <p className="muted">{stats.open > 0 ? `${stats.open} still open` : 'Nothing open'}{stats.inProgress ? ` · ${stats.inProgress} in progress` : ''}</p>
              )}
              <p className="streak" title="Consecutive days with a goal done or a highlight. A quiet morning does not break it.">
                <Flame size={18} aria-hidden /> {streak} active day{streak === 1 ? '' : 's'} in a row
              </p>
            </div>
          </Card>

          <Card title={<><Sparkles size={20} aria-hidden /> Highlights</>}>
            {items.goals.length === 0 && items.highlights.length === 0 ? (
              <p className="muted">Finished goals and the GitHub items you highlight appear here.</p>
            ) : (
              <ul className="highlights">
                {items.goals.map((g) => (
                  <li key={g.id}>
                    <CheckCircle2 size={16} aria-hidden className="ok" />
                    <span>
                      {g.title}
                      {g.focus && <span className="tag"><Star size={12} aria-hidden /> focus</span>}
                      {g.source && safeUrl(g.source.url) && (
                        <a href={safeUrl(g.source.url) as string} target="_blank" rel="noopener noreferrer" aria-label={`Open ${g.source.repo} #${g.source.number}`}> <ExternalLink size={12} aria-hidden /></a>
                      )}
                    </span>
                  </li>
                ))}
                {items.highlights.map((h) => (
                  <li key={h.id}>
                    {KIND_ICON[h.kind]}
                    <span>
                      {h.title} <span className="muted">· {KIND_LABEL[h.kind]} · {h.repo}</span>
                      {safeUrl(h.url) && (
                        <a href={safeUrl(h.url) as string} target="_blank" rel="noopener noreferrer" aria-label={`Open ${h.title}`}> <ExternalLink size={12} aria-hidden /></a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="card-actions">
              <Button size="sm" icon={copy === 'copied' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} onClick={doCopy}>
                {copy === 'copied' ? 'Copied!' : 'Copy day summary'}
              </Button>
              <Button size="sm" icon={<Download size={16} aria-hidden />} onClick={() => downloadText(summaryFileName(date), text)}>
                Download
              </Button>
            </div>
            {copy === 'failed' && (
              <>
                <p className="hint">Clipboard blocked — select and copy manually:</p>
                <textarea className="manual-copy" readOnly rows={8} value={text} onFocus={(e) => e.target.select()} aria-label="Day summary text" />
              </>
            )}
          </Card>

          {isToday && (
            <GitHubPanel
              day={day}
              onAddGoal={(t, source) => edit((d) => addGoal(d, t, Date.now(), { source }))}
              onTogglePin={(h) => edit((d) => togglePin(d, h))}
            />
          )}
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          title="Remove this goal?"
          message={`"${removing.title}" will be deleted from this day.`}
          confirmLabel="Remove goal"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            edit((d) => removeGoal(d, removing.id));
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}

function GoalRow({
  goal: g,
  first,
  last,
  onStatus,
  onPatch,
  onFocus,
  onMove,
  onRemove,
}: {
  goal: Goal;
  first: boolean;
  last: boolean;
  onStatus: (s: GoalStatus) => void;
  onPatch: (p: Partial<Goal>) => void;
  onFocus: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(g.title);
  const done = g.status === 'done';
  const href = g.source ? safeUrl(g.source.url) : null;

  return (
    <li className={`goal gs-row-${g.status} ${g.focus ? 'focus' : ''}`}>
      <div className="goal-main">
        <label className="goal-check">
          <input type="checkbox" checked={done} onChange={(e) => onStatus(e.target.checked ? 'done' : 'todo')} aria-label={`Mark "${g.title}" ${done ? 'not done' : 'done'}`} />
        </label>
        <div className="goal-body">
          {editing ? (
            <form
              className="add-goal"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) onPatch({ title: draft.trim() });
                setEditing(false);
              }}
            >
              <input aria-label="Goal title" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus maxLength={140} />
              <Button type="submit" size="sm" variant="primary">Save</Button>
              <Button size="sm" onClick={() => { setDraft(g.title); setEditing(false); }}>Cancel</Button>
            </form>
          ) : (
            <p className="goal-title">
              {g.title}
              {g.source && href && (
                <a className="tag" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${g.source.repo} #${g.source.number} on GitHub`}>
                  <CircleDot size={12} aria-hidden /> {g.source.repo}#{g.source.number}
                </a>
              )}
              {g.carriedFrom && <span className="tag">Carried over</span>}
            </p>
          )}
          {g.note && !open && <small>{g.note}</small>}
        </div>
        <div className="goal-controls">
          <label className="inline-select">
            <span className="sr-only">Status for {g.title}</span>
            <select value={g.status} onChange={(e) => onStatus(e.target.value as GoalStatus)} aria-label={`Status for ${g.title}`}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <button type="button" className={`icon-btn lg ${g.focus ? 'on' : ''}`} onClick={onFocus} aria-pressed={g.focus} aria-label={g.focus ? `Remove focus from ${g.title}` : `Make ${g.title} my focus goal`} title="Focus goal">
            <Star size={18} aria-hidden />
          </button>
          <button type="button" className="icon-btn lg" onClick={() => setEditing(true)} aria-label={`Edit ${g.title}`} title="Edit"><Pencil size={16} aria-hidden /></button>
          <button type="button" className="icon-btn lg" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Notes for ${g.title}`} title="Notes"><StickyNote size={16} aria-hidden /></button>
          <button type="button" className="icon-btn lg" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${g.title} up`}><ArrowUp size={16} aria-hidden /></button>
          <button type="button" className="icon-btn lg" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${g.title} down`}><ArrowDown size={16} aria-hidden /></button>
          <button type="button" className="icon-btn lg danger" onClick={onRemove} aria-label={`Remove ${g.title}`} title="Remove"><Trash2 size={16} aria-hidden /></button>
        </div>
      </div>
      {open && (
        <Field label="Note" multiline rows={2} value={g.note} onChange={(v) => onPatch({ note: v })} />
      )}
    </li>
  );
}
