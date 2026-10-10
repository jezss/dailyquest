import { useEffect, useState } from 'react';
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
  Link2,
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
import type { Goal, GoalSource, GoalStatus } from '../types';
import { useStore } from '../store';
import { Button, Card, ConfirmDialog, Empty, Field, ProgressRing, STATUS_LABEL, copyText, downloadText } from '../ui';
import { GitHubPanel, closedLinked, useGitHub } from './GitHubPanel';
import {
  addGoal,
  addIssueItem,
  carryCandidates,
  carryOver,
  currentStreak,
  dayStats,
  dismissCarry,
  doneItems,
  getDay,
  hasSource,
  issueIndex,
  linkToIssue,
  moveWithinKind,
  removeGoal,
  setGoalStatus,
  setIssueState,
  togglePin,
  toggleFocus,
  updateGoal,
} from '../logic/days';
import { KIND_LABEL, buildDaySummary, summaryFileName } from '../logic/summary';
import { addDays, formatDate, formatShortDate, toISODate } from '../logic/util';
import { issueSource, safeUrl } from '../logic/github';
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

  const issueItems = day.goals.filter((g) => g.kind === 'issue');
  const ownItems = day.goals.filter((g) => g.kind === 'own');
  // Assigned issues are only offered, never added on their own: "Work on today" is the explicit choice.
  const assignedTodo = isToday && activity ? activity.assigned.filter((i) => !hasSource(day, i)) : [];

  // Issues an own item can be linked to: today's assigned issues, then recently worked ones.
  const linkChoices: LinkChoice[] = [];
  const seen = new Set<string>();
  const offer = (source: GoalSource, t: string) => {
    const key = `${source.repo}#${source.number}`;
    if (seen.has(key)) return;
    seen.add(key);
    linkChoices.push({ source, title: t });
  };
  for (const i of activity?.assigned ?? []) offer(issueSource(i), i.title);
  for (const s of issueIndex(data).slice(0, 15)) offer(s.source, s.title);

  // Remember what GitHub says about issues on today's list (open/closed). Display only; never changes a status.
  useEffect(() => {
    if (!isToday || !activity) return;
    update((d) => {
      let next = d;
      for (const i of activity.closed) next = setIssueState(next, i, 'closed', today);
      for (const i of activity.assigned) next = setIssueState(next, i, 'open', today);
      return next;
    });
    // `update` takes a function, so calling it from this closure is safe without listing it as a dependency.
  }, [activity, isToday, today]);

  const itemList = (list: Goal[]) => (
    <ul className="goal-list">
      {list.map((g, i) => (
        <GoalRow
          key={g.id}
          goal={g}
          first={i === 0}
          last={i === list.length - 1}
          linkChoices={linkChoices}
          onStatus={(s) => edit((d) => setGoalStatus(d, g.id, s, Date.now()))}
          onPatch={(p) => edit((d) => updateGoal(d, g.id, p))}
          onFocus={() => edit((d) => toggleFocus(d, g.id))}
          onMove={(dir) => edit((d) => moveWithinKind(d, g.id, dir))}
          onLink={(source) => edit((d) => linkToIssue(d, g.id, source))}
          onRemove={() => setRemoving(g)}
        />
      ))}
    </ul>
  );

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

          <Card title={<><CircleDot size={20} aria-hidden /> Issues</>}>
            {issueItems.length > 0 && itemList(issueItems)}
            {issueItems.length === 0 && assignedTodo.length === 0 && (
              <Empty icon={<CircleDot size={28} aria-hidden />} title="No issues on this day">
                {!isToday
                  ? 'No GitHub issues were worked on this day.'
                  : gh.phase === 'not-configured'
                    ? 'Connect GitHub (see Settings) and your assigned issues will show up here.'
                    : gh.phase === 'ready' && !activity
                      ? 'Loading your assigned issues…'
                      : 'No open issues are assigned to you.'}
              </Empty>
            )}
            {assignedTodo.length > 0 && (
              <section aria-label="Assigned to me, not on today's list" className="assigned">
                <h4 className="gh-h">Assigned to me — not on today's list ({assignedTodo.length})</h4>
                <ul className="gh-list">
                  {assignedTodo.map((i) => (
                    <li className="gh-item" key={`${i.repo}#${i.number}`}>
                      <div className="gh-main">
                        <strong>#{i.number} {i.title}</strong>
                        <small>{i.repo} {i.labels.map((l) => <span key={l} className="tag">{l}</span>)}</small>
                      </div>
                      <div className="gh-actions">
                        {safeUrl(i.url) && (
                          <a className="btn btn-sm btn-ghost" href={safeUrl(i.url) as string} target="_blank" rel="noopener noreferrer" aria-label={`Open #${i.number} ${i.title} on GitHub (new tab)`}>
                            <ExternalLink size={14} aria-hidden /> Open
                          </a>
                        )}
                        <Button size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} onClick={() => edit((d) => addIssueItem(d, issueSource(i), i.title, Date.now()))} aria-label={`Work on #${i.number} ${i.title} today`}>
                          Work on today
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </Card>

          <Card title={<><Target size={20} aria-hidden /> Not on GitHub</>}>
            <form
              className="add-goal"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <label htmlFor="new-goal" className="sr-only">Add a goal that is not a GitHub issue</label>
              <input id="new-goal" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add something that isn't an issue, press Enter" maxLength={140} />
              <Button type="submit" variant="primary" icon={<Plus size={18} aria-hidden />} disabled={!title.trim()}>
                Add
              </Button>
            </form>
            {tooMany && (
              <p className="note" role="status">
                <Flame size={16} aria-hidden /> That's {counted} items today. Pick one as your focus (★) and let the rest be bonus.
              </p>
            )}
            {ownItems.length === 0 ? (
              <p className="muted">Nothing here. Things without an issue — and anything you can later link to one — go in this list.</p>
            ) : (
              itemList(ownItems)
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
            <GitHubPanel day={day} onTogglePin={(h) => edit((d) => togglePin(d, h))} />
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

interface LinkChoice {
  source: GoalSource;
  title: string;
}

function GoalRow({
  goal: g,
  first,
  last,
  linkChoices,
  onStatus,
  onPatch,
  onFocus,
  onMove,
  onLink,
  onRemove,
}: {
  goal: Goal;
  first: boolean;
  last: boolean;
  linkChoices: LinkChoice[];
  onStatus: (s: GoalStatus) => void;
  onPatch: (p: Partial<Goal>) => void;
  onFocus: () => void;
  onMove: (dir: -1 | 1) => void;
  onLink: (source: GoalSource) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [choice, setChoice] = useState('');
  const [draft, setDraft] = useState(g.title);
  const done = g.status === 'done';
  const href = g.source ? safeUrl(g.source.url) : null;
  const isIssue = g.kind === 'issue';
  const ref = g.source ? `${g.source.repo}#${g.source.number}` : '';

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
              {g.source?.state === 'closed' && <span className="tag"><CheckCircle2 size={12} aria-hidden /> Closed on GitHub</span>}
              {g.carriedFrom && <span className="tag">Carried over</span>}
            </p>
          )}
          {!isIssue && g.note && !open && <small>{g.note}</small>}
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
          {!isIssue && (
            <>
              <button type="button" className="icon-btn lg" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Notes for ${g.title}`} title="Notes"><StickyNote size={16} aria-hidden /></button>
              <button type="button" className="icon-btn lg" onClick={() => setLinking(!linking)} aria-expanded={linking} aria-label={`Link ${g.title} to a GitHub issue`} title="Link to a GitHub issue"><Link2 size={16} aria-hidden /></button>
            </>
          )}
          <button type="button" className="icon-btn lg" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${g.title} up`}><ArrowUp size={16} aria-hidden /></button>
          <button type="button" className="icon-btn lg" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${g.title} down`}><ArrowDown size={16} aria-hidden /></button>
          <button type="button" className="icon-btn lg danger" onClick={onRemove} aria-label={`Remove ${g.title}`} title="Remove"><Trash2 size={16} aria-hidden /></button>
        </div>
      </div>
      {isIssue && (
        <Field
          label={`Note on ${ref} for this day`}
          multiline
          rows={2}
          value={g.note}
          onChange={(v) => onPatch({ note: v })}
          placeholder="What you did, what's blocking, what's next"
        />
      )}
      {!isIssue && open && <Field label="Note" multiline rows={2} value={g.note} onChange={(v) => onPatch({ note: v })} />}
      {!isIssue && linking && (
        <div className="link-issue">
          {linkChoices.length === 0 ? (
            <p className="muted">No issues to link to yet. Connect GitHub, or add an issue to a day first.</p>
          ) : (
            <>
              <label className="inline-select">
                <span>Link “{g.title}” to</span>
                <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                  <option value="">Choose an issue…</option>
                  {linkChoices.map((c) => (
                    <option key={`${c.source.repo}#${c.source.number}`} value={`${c.source.repo}#${c.source.number}`}>
                      {c.source.repo}#{c.source.number} — {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="sm"
                variant="primary"
                disabled={!choice}
                onClick={() => {
                  const c = linkChoices.find((x) => `${x.source.repo}#${x.source.number}` === choice);
                  if (c) onLink(c.source);
                }}
              >
                Link
              </Button>
              <p className="hint">This item becomes a note on the issue. If the issue is already on this day, its text is added to that issue's note.</p>
            </>
          )}
        </div>
      )}
    </li>
  );
}
