import { useRef, useState } from 'react';
import { Award, Check, CalendarDays, Copy, Download, Eye, Flame, History as HistoryIcon, Lock, Trash2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { Button, Card, ConfirmDialog, Empty, Field, copyText, downloadText } from '../ui';
import { useGitHub } from './GitHubPanel';
import { ACHIEVEMENTS, evaluateAchievements, progressFor } from '../logic/achievements';
import { currentStreak, dayStats, getDay, isActiveDay, totalGoalsDone } from '../logic/days';
import { buildWeekSummary } from '../logic/summary';
import { parseBackup } from '../logic/storage';
import { makeSampleData } from '../logic/sample';
import { formatDate, formatShortDate, lastDates, toISODate, weekdayLetter } from '../logic/util';
import type { View } from '../App';

// ---------- History ----------

export function HistoryScreen({ go }: { go: (v: View) => void }) {
  const { data } = useStore();
  const settings = data.settings;
  const today = toISODate(Date.now());
  const week = lastDates(today, 7);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const dates = Object.keys(data.days)
    .filter((k) => {
      const d = data.days[k];
      return d.goals.length > 0 || d.highlights.length > 0 || d.win || d.reflection;
    })
    .sort()
    .reverse();
  const activeThisWeek = week.filter((d) => isActiveDay(data.days[d])).length;
  const streak = currentStreak(data, today);
  const weekText = buildWeekSummary(week.map((d) => getDay(data, d)), settings.displayName);

  return (
    <div className="stack">
      <div className="page-head row-between">
        <div>
          <h2>History</h2>
          <p className="muted">Everything you've recorded, newest first. Saved in this browser only.</p>
        </div>
        <Button
          icon={copy === 'copied' ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
          onClick={async () => setCopy((await copyText(weekText)) === 'failed' ? 'failed' : 'copied')}
        >
          {copy === 'copied' ? 'Copied!' : copy === 'failed' ? 'Clipboard blocked' : 'Copy this week'}
        </Button>
      </div>

      <div className="stat-row">
        <span className="stat"><CalendarDays size={20} aria-hidden /> {activeThisWeek} active day{activeThisWeek === 1 ? '' : 's'} in the last 7</span>
        <span className="stat"><Flame size={20} aria-hidden /> {streak}-day streak</span>
        <span className="stat"><Check size={20} aria-hidden /> {totalGoalsDone(data)} goals done in total</span>
      </div>

      <Card title="Last 7 days">
        <ol className="week-strip">
          {week.map((d) => {
            const s = dayStats(getDay(data, d));
            const hl = getDay(data, d).highlights.length;
            return (
              <li key={d}>
                <button type="button" className={`week-day ${d === today ? 'today' : ''} ${isActiveDay(data.days[d]) ? 'active' : ''}`} onClick={() => go({ name: 'today', date: d })} aria-label={`${formatShortDate(d)}: ${s.done} goals done${hl ? `, ${hl} highlights` : ''}`}>
                  <span>{weekdayLetter(d)}</span>
                  <strong>{s.done}</strong>
                  <small>{s.total ? `of ${s.total - s.skipped}` : '—'}</small>
                </button>
              </li>
            );
          })}
        </ol>
      </Card>

      {dates.length === 0 ? (
        <Empty icon={<HistoryIcon size={32} aria-hidden />} title="Nothing recorded yet">
          Add a few goals on the Today screen and they'll build up here.
          <br />
          <Button variant="primary" onClick={() => go({ name: 'today' })}>Go to Today</Button>
        </Empty>
      ) : (
        <ul className="history">
          {dates.map((k) => {
            const day = data.days[k];
            const s = dayStats(day);
            return (
              <li key={k} className="card history-item">
                <div className="history-main">
                  <h3>{formatDate(k)}</h3>
                  <div className="tags">
                    <span className="tag">{s.done} of {s.total - s.skipped} goals done</span>
                    {day.highlights.length > 0 && <span className="tag">{day.highlights.length} GitHub highlight{day.highlights.length === 1 ? '' : 's'}</span>}
                    {s.allDone && s.done > 0 && <span className="tag gs-done">All done</span>}
                  </div>
                  {day.win && <p className="muted">Win: {day.win}</p>}
                </div>
                <Button icon={<Eye size={18} aria-hidden />} onClick={() => go({ name: 'today', date: k })}>
                  Open
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- Achievements ----------

export function AchievementsScreen() {
  const { data } = useStore();
  const earned = evaluateAchievements(data);
  return (
    <div className="stack">
      <div className="page-head">
        <h2>Achievements</h2>
        <p className="muted">
          {earned.length} of {ACHIEVEMENTS.length} earned. They are worked out from your saved days, so nothing unlocks unless the records show it.
        </p>
      </div>
      <ul className="badge-grid">
        {ACHIEVEMENTS.map((a) => {
          const e = earned.find((x) => x.id === a.id);
          return (
            <li key={a.id} className={`badge ${e ? '' : 'locked'}`}>
              <span className="badge-icon">{e ? <Award size={22} aria-hidden /> : <Lock size={20} aria-hidden />}</span>
              <span>
                <strong>{a.name}</strong>
                <small>{e ? `${a.description} Earned ${formatShortDate(e.date)}.` : `To earn: ${a.criteria}`}</small>
                {!e && progressFor(data, a.id) && <small>Progress: {progressFor(data, a.id)}</small>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Settings ----------

export function SettingsScreen() {
  const { data, setSettings, resetEverything, replaceAll, saveState } = useStore();
  const { state: gh, refresh } = useGitHub();
  const [confirm, setConfirm] = useState<null | 'erase' | 'sample' | 'import'>(null);
  const [pending, setPending] = useState<ReturnType<typeof parseBackup>>(null);
  const [importMsg, setImportMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const hasData = Object.keys(data.days).length > 0;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const parsed = parseBackup(await f.text());
    if (!parsed) {
      setImportMsg('That file is not a valid Daily Quest backup.');
      return;
    }
    setImportMsg('');
    setPending(parsed);
    setConfirm('import');
  };

  return (
    <div className="stack">
      <div className="page-head"><h2>Settings</h2></div>

      <Card title="You">
        <Field label="Your name (optional, used in summaries)" value={data.settings.displayName} onChange={(v) => setSettings({ displayName: v })} maxLength={40} />
        <Field
          label="Gentle goal limit (1–12)"
          type="number"
          value={String(data.settings.goalsSoftLimit)}
          onChange={(v) => setSettings({ goalsSoftLimit: Math.max(1, Math.min(12, Math.round(Number(v) || 5))) })}
          hint="You'll get a friendly nudge to pick a focus goal when you plan more than this. It never blocks you."
        />
      </Card>

      <Card title="GitHub">
        {gh.phase === 'ready' ? (
          <p>Connected to <strong>{gh.repos}</strong>{gh.activity ? ` as ${gh.activity.username}` : ''}. {gh.error ?? ''}</p>
        ) : gh.phase === 'invalid' ? (
          <p className="note">Config problem: {gh.message}</p>
        ) : gh.phase === 'not-configured' ? (
          <p className="muted">Not connected. Copy <code>public/daily-quest.config.example.json</code> to <code>public/daily-quest.config.json</code> and fill it in. The README has the steps.</p>
        ) : (
          <p className="muted">Checking…</p>
        )}
        {gh.phase === 'ready' && <Button onClick={refresh}>Refresh GitHub now</Button>}
      </Card>

      <Card title="Your data">
        <p>
          Everything is stored in this browser only. Storage status:{' '}
          <strong>{saveState === 'saved' ? 'saved' : saveState === 'failed' ? 'NOT saving — browser storage is blocked or full' : 'not yet saved'}</strong>.
        </p>
        <div className="card-actions">
          <Button icon={<Download size={18} aria-hidden />} onClick={() => downloadText(`daily-quest-backup-${toISODate(Date.now())}.json`, JSON.stringify(data, null, 2), 'application/json')}>
            Export backup
          </Button>
          <Button icon={<Upload size={18} aria-hidden />} onClick={() => fileRef.current?.click()}>
            Import backup
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Choose backup file" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <Button disabled={hasData} title={hasData ? 'Only available when there is no data yet' : ''} onClick={() => setConfirm('sample')}>
            Load sample week
          </Button>
          <Button variant="danger" icon={<Trash2 size={18} aria-hidden />} onClick={() => setConfirm('erase')}>
            Erase everything
          </Button>
        </div>
        {importMsg && <p className="note" role="alert">{importMsg}</p>}
      </Card>

      {confirm === 'erase' && (
        <ConfirmDialog title="Erase all data?" message="All goals, highlights and reflections will be deleted from this browser. This cannot be undone. Export a backup first if unsure." confirmLabel="Erase everything" onCancel={() => setConfirm(null)} onConfirm={() => { resetEverything(false); setConfirm(null); }} />
      )}
      {confirm === 'sample' && (
        <ConfirmDialog danger={false} title="Load a sample week?" message="Adds five made-up days so you can explore the app. You can erase them from here at any time." confirmLabel="Load sample" onCancel={() => setConfirm(null)} onConfirm={() => { replaceAll(makeSampleData()); setConfirm(null); }} />
      )}
      {confirm === 'import' && pending && (
        <ConfirmDialog title="Replace your data with this backup?" message={`This replaces everything currently saved with ${Object.keys(pending.days).length} day(s) from the file.`} confirmLabel="Import backup" onCancel={() => { setConfirm(null); setPending(null); }} onConfirm={() => { replaceAll(pending); setConfirm(null); setPending(null); }} />
      )}
    </div>
  );
}
