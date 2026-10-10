import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, CircleDot, ExternalLink, GitCommit, GitMerge, Plus, RefreshCw, Star } from 'lucide-react';
import type { Day, GoalSource, Highlight } from '../types';
import { Button, Card } from '../ui';
import {
  GitHubError,
  commitHighlight,
  fetchActivity,
  issueHighlight,
  issueSource,
  parseConfig,
  prHighlight,
  safeUrl,
} from '../logic/github';
import type { GhActivity, GitHubConfig } from '../logic/github';
import { hasSource, isPinned } from '../logic/days';
import { startOfDayMs, toISODate } from '../logic/util';

type State =
  | { phase: 'loading-config' }
  | { phase: 'not-configured' }
  | { phase: 'invalid'; message: string }
  | { phase: 'ready'; repos: string; activity: GhActivity | null; loading: boolean; error: string | null; at: number | null };

interface Ctx {
  state: State;
  refresh: () => void;
}
const GhCtx = createContext<Ctx | null>(null);

export function GitHubProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: 'loading-config' });
  const cfg = useRef<GitHubConfig | null>(null);

  const load = useCallback(async () => {
    const c = cfg.current;
    if (!c) return;
    const repos = c.repos.map((r) => `${r.owner}/${r.name}`).join(', ');
    setState((s) => (s.phase === 'ready' ? { ...s, loading: true, error: null } : s));
    try {
      const activity = await fetchActivity(c, startOfDayMs(toISODate(Date.now())));
      setState({ phase: 'ready', repos, activity, loading: false, error: null, at: Date.now() });
    } catch (e) {
      const msg = e instanceof GitHubError ? e.message : 'Could not load GitHub activity.';
      setState((s) => ({
        phase: 'ready',
        repos,
        activity: s.phase === 'ready' ? s.activity : null,
        loading: false,
        error: msg,
        at: s.phase === 'ready' ? s.at : null,
      }));
    }
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}daily-quest.config.json`, { cache: 'no-store' });
        const text = res.ok ? await res.text() : '';
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* missing file (or dev-server HTML fallback) */
        }
        if (dead) return;
        const parsed = parseConfig(json);
        if (parsed.status === 'ok') {
          cfg.current = parsed.config;
          setState({ phase: 'ready', repos: parsed.config.repos.map((r) => `${r.owner}/${r.name}`).join(', '), activity: null, loading: true, error: null, at: null });
          load();
        } else if (parsed.status === 'invalid') setState({ phase: 'invalid', message: parsed.message });
        else setState({ phase: 'not-configured' });
      } catch {
        if (!dead) setState({ phase: 'not-configured' });
      }
    })();
    return () => {
      dead = true;
    };
  }, [load]);

  const value = useMemo(() => ({ state, refresh: load }), [state, load]);
  return <GhCtx.Provider value={value}>{children}</GhCtx.Provider>;
}

export function useGitHub(): Ctx {
  const c = useContext(GhCtx);
  if (!c) throw new Error('GitHubProvider missing');
  return c;
}

/** Issues (from today's GitHub data) that were closed while a linked goal is still open. */
export function closedLinked(day: Day, activity: GhActivity | null) {
  if (!activity) return [];
  return day.goals.filter(
    (g) => g.source && g.status !== 'done' && activity.closed.some((i) => i.repo === g.source?.repo && i.number === g.source?.number),
  );
}

const ago = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (Number.isNaN(m)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
};

function Row({
  title,
  meta,
  url,
  actions,
}: {
  title: string;
  meta: ReactNode;
  url: string;
  actions?: ReactNode;
}) {
  const href = safeUrl(url);
  return (
    <li className="gh-item">
      <div className="gh-main">
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
      <div className="gh-actions">
        {href && (
          <a className="btn btn-sm btn-ghost" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title} on GitHub (new tab)`}>
            <ExternalLink size={14} aria-hidden /> Open
          </a>
        )}
        {actions}
      </div>
    </li>
  );
}

interface PanelProps {
  day: Day;
  onAddGoal: (title: string, source: GoalSource) => void;
  onTogglePin: (h: Omit<Highlight, 'id'>) => void;
}

/** Read-only GitHub activity for today. Everything shown is a choice: nothing is added or ticked automatically. */
export function GitHubPanel({ day, onAddGoal, onTogglePin }: PanelProps) {
  const { state, refresh } = useGitHub();
  if (state.phase === 'loading-config') return null;

  const title = (
    <>
      <CircleDot size={20} aria-hidden /> GitHub
    </>
  );
  if (state.phase === 'not-configured') {
    return (
      <Card title={title}>
        <p className="muted">
          Not connected. Copy <code>public/daily-quest.config.example.json</code> to <code>public/daily-quest.config.json</code>, add your username, repos and a
          read-only token, then reload. See the README.
        </p>
      </Card>
    );
  }
  if (state.phase === 'invalid') {
    return (
      <Card title={title}>
        <p className="note">Config problem: {state.message}</p>
      </Card>
    );
  }

  const a = state.activity;
  const pinBtn = (h: Omit<Highlight, 'id'>) => {
    const pinned = isPinned(day, h.key);
    return (
      <Button size="sm" variant={pinned ? 'success' : 'secondary'} icon={pinned ? <Check size={14} aria-hidden /> : <Star size={14} aria-hidden />} onClick={() => onTogglePin(h)} aria-pressed={pinned}>
        {pinned ? 'Highlighted' : 'Highlight'}
      </Button>
    );
  };

  return (
    <Card
      title={<>{title} — {state.repos}</>}
      action={
        <Button size="sm" icon={<RefreshCw size={16} aria-hidden />} onClick={refresh} disabled={state.loading}>
          {state.loading ? 'Loading…' : 'Refresh'}
        </Button>
      }
    >
      {state.error && <p className="note" role="alert">{state.error}</p>}
      {a?.errors.map((e) => (
        <p key={e} className="note" role="alert">{e}</p>
      ))}
      {!a && state.loading && <p className="muted">Loading your GitHub activity…</p>}
      {a && (
        <div className="stack">
          <p className="muted">Signed in as <strong>{a.username}</strong>{state.at ? ` · updated ${ago(new Date(state.at).toISOString())}` : ''}</p>

          <section aria-label="Assigned to me">
            <h4 className="gh-h">Assigned to me ({a.assigned.length})</h4>
            {a.assigned.length === 0 ? (
              <p className="muted">No open issues assigned to you.</p>
            ) : (
              <ul className="gh-list">
                {a.assigned.map((i) => {
                  const added = hasSource(day, i);
                  return (
                    <Row
                      key={`${i.repo}#${i.number}`}
                      title={`#${i.number} ${i.title}`}
                      url={i.url}
                      meta={<>{i.repo} {i.labels.map((l) => <span key={l} className="tag">{l}</span>)}</>}
                      actions={
                        <Button size="sm" variant={added ? 'secondary' : 'primary'} disabled={added} icon={added ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />} onClick={() => onAddGoal(i.title, issueSource(i))}>
                          {added ? 'In goals' : 'Add as goal'}
                        </Button>
                      }
                    />
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="Done today on GitHub">
            <h4 className="gh-h">Done today on GitHub</h4>
            {a.closed.length + a.prs.length === 0 && <p className="muted">No closed issues or merged PRs yet today.</p>}
            <ul className="gh-list">
              {a.closed.map((i) => (
                <Row key={`c${i.repo}#${i.number}`} title={`#${i.number} ${i.title}`} url={i.url} meta={<><CircleDot size={13} aria-hidden /> Issue closed · {i.repo}</>} actions={pinBtn(issueHighlight(i))} />
              ))}
              {a.prs.map((p) => (
                <Row key={`p${p.repo}#${p.number}`} title={`#${p.number} ${p.title}`} url={p.url} meta={<><GitMerge size={13} aria-hidden /> PR merged · {p.repo}</>} actions={pinBtn(prHighlight(p))} />
              ))}
            </ul>
          </section>

          <details>
            <summary className="gh-h">My commits today ({a.commits.length})</summary>
            {a.commits.length === 0 ? (
              <p className="muted">No commits yet today.</p>
            ) : (
              <ul className="gh-list">
                {a.commits.slice(0, 25).map((c) => (
                  <Row key={`${c.repo}@${c.sha}`} title={c.title || c.sha.slice(0, 7)} url={c.url} meta={<><GitCommit size={13} aria-hidden /> {c.repo} · {c.sha.slice(0, 7)} · {ago(c.at)}</>} actions={pinBtn(commitHighlight(c))} />
                ))}
              </ul>
            )}
          </details>
        </div>
      )}
      <p className="hint">Read-only. The app never changes anything on GitHub. Issues are matched by assignee, merged PRs and commits by author.</p>
    </Card>
  );
}
