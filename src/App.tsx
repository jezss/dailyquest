import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Award, CheckCircle2, FlaskConical, History, Info, Settings as Cog, Sun, Swords, TriangleAlert } from 'lucide-react';
import { StoreProvider, useStore } from './store';
import { Today } from './components/Today';
import { AchievementsScreen, HistoryScreen, SettingsScreen } from './components/Screens';
import { GitHubProvider } from './components/GitHubPanel';
import { Button } from './ui';
import { toISODate } from './logic/util';

export type View =
  | { name: 'today'; date?: string }
  | { name: 'history' }
  | { name: 'achievements' }
  | { name: 'settings' };

function Shell() {
  const { data, saveState, loadStatus, loadMessage, resetEverything, dismissNotice } = useStore();
  const [view, setView] = useState<View>({ name: 'today' });
  const go = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };

  // Warn before closing the tab only when unsaved work could actually be lost.
  useEffect(() => {
    if (saveState !== 'failed') return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [saveState]);

  const nav: { name: View['name']; label: string; icon: ReactElement }[] = [
    { name: 'today', label: 'Today', icon: <Sun size={18} aria-hidden /> },
    { name: 'history', label: 'History', icon: <History size={18} aria-hidden /> },
    { name: 'achievements', label: 'Achievements', icon: <Award size={18} aria-hidden /> },
    { name: 'settings', label: 'Settings', icon: <Cog size={18} aria-hidden /> },
  ];

  if (loadStatus === 'corrupt') {
    return (
      <div className="page">
        <div className="card stack" role="alert">
          <h1><TriangleAlert aria-hidden /> Saved data could not be read</h1>
          <p>{loadMessage}</p>
          <p>Nothing has been overwritten — a copy of the unreadable data was kept in this browser. Reset to continue with a fresh start.</p>
          <div className="card-actions">
            <Button variant="danger" onClick={() => resetEverything(false)}>Reset and start clean</Button>
          </div>
        </div>
      </div>
    );
  }

  const today = toISODate(Date.now());
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <button type="button" className="brand" onClick={() => go({ name: 'today' })} aria-label="Daily Quest — today">
          <span className="logo" aria-hidden><Swords size={22} /></span>
          <span>Daily Quest</span>
        </button>
        <nav aria-label="Main">
          {nav.map((n) => (
            <button
              key={n.name}
              type="button"
              className={`nav-btn ${view.name === n.name ? 'active' : ''}`}
              aria-current={view.name === n.name ? 'page' : undefined}
              onClick={() => go({ name: n.name } as View)}
            >
              {n.icon} {n.label}
            </button>
          ))}
        </nav>
        <span className={`save-state ${saveState}`} role="status">
          {saveState === 'saved' ? (<><CheckCircle2 size={16} aria-hidden /> Saved in this browser</>) : saveState === 'failed' ? (<><TriangleAlert size={16} aria-hidden /> Not saved — storage unavailable</>) : 'Loading…'}
        </span>
      </header>
      <main id="main" className="page" tabIndex={-1}>
        {loadStatus === 'unavailable' && (
          <div className="banner warn" role="alert">
            <TriangleAlert size={20} aria-hidden />
            <p>Browser storage is unavailable, so nothing can be saved. Copy or download your summary before closing the tab.</p>
          </div>
        )}
        {loadStatus === 'migrated' && (
          <div className="banner info" role="note">
            <Info size={20} aria-hidden />
            <p><strong>Daily Quest is now a personal goals tracker.</strong> {loadMessage}</p>
            <Button onClick={dismissNotice}>Got it</Button>
          </div>
        )}
        {data.sampleLoaded && (
          <div className="banner demo" role="note">
            <FlaskConical size={20} aria-hidden />
            <p><strong>Sample data is loaded.</strong> These days are examples. Erase them in Settings when you want to start for real.</p>
          </div>
        )}
        {view.name === 'today' && <Today key={view.date ?? today} date={view.date ?? today} go={go} />}
        {view.name === 'history' && <HistoryScreen go={go} />}
        {view.name === 'achievements' && <AchievementsScreen />}
        {view.name === 'settings' && <SettingsScreen />}
      </main>
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <GitHubProvider>
        <Shell />
      </GitHubProvider>
    </StoreProvider>
  );
}
