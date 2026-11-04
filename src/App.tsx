import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { GlobalUI, toast } from './components/ui';
import { FileSaveUI } from './components/FileSave';
import { LockGate } from './components/Lock';
import { useApplyTheme, useSettings } from './lib/hooks';
import { flushAll } from './lib/saver';
import { lazyWithRetry } from './lib/lazyRetry';
import { ErrorBoundary } from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import NotesPage from './pages/NotesPage';

// Selten genutzte bzw. große Bereiche erst bei Bedarf laden (alle Dateien sind offline vorgehalten)
const NoteEditorPage = lazyWithRetry(() => import('./pages/NoteEditorPage'));
const TasksPage = lazyWithRetry(() => import('./pages/TasksPage'));
const ProjectsPage = lazyWithRetry(() => import('./pages/ProjectsPage'));
const ProjectDetail = lazyWithRetry(() => import('./pages/ProjectsPage').then((m) => ({ default: m.ProjectDetail })));
const SearchPage = lazyWithRetry(() => import('./pages/SearchPage'));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'));

function RouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}

function FlushOnNavigate() {
  const location = useLocation();
  useEffect(() => () => flushAll(), [location.pathname]);
  return null;
}

function UpdatePrompt() {
  const [update, setUpdate] = useState<null | (() => void)>(null);
  useEffect(() => {
    const on = (e: Event) => setUpdate(() => (e as CustomEvent<() => void>).detail);
    const offline = () => toast('TE Notes ist jetzt offline verfügbar');
    window.addEventListener('te-sw-update', on);
    window.addEventListener('te-sw-offline-ready', offline);
    return () => {
      window.removeEventListener('te-sw-update', on);
      window.removeEventListener('te-sw-offline-ready', offline);
    };
  }, []);
  if (!update) return null;
  return (
    <div className="update-bar" role="status">
      <span>Neue Version verfügbar – wird automatisch übernommen, sobald Sie die App verlassen.</span>
      <button className="btn btn-sm btn-primary" onClick={update}>
        Jetzt aktualisieren
      </button>
      <button className="btn btn-sm btn-ghost" onClick={() => setUpdate(null)}>Später</button>
    </div>
  );
}

/** Editor & Seiten vorab laden, damit „Neue Notiz“ ohne Verzögerung öffnet (schnelles Erfassen) */
function usePrefetch() {
  useEffect(() => {
    const t = setTimeout(() => {
      void import('./pages/NoteEditorPage').catch(() => {});
      void import('./pages/TasksPage').catch(() => {});
      void import('./pages/SearchPage').catch(() => {});
      void import('./pages/ProjectsPage').catch(() => {});
      void import('./pages/SettingsPage').catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, []);
}

export default function App() {
  const settings = useSettings();
  useApplyTheme(settings.theme);
  usePrefetch();
  return (
    <HashRouter>
      <FlushOnNavigate />
      <LockGate>
        <Layout>
          <RouteBoundary>
          <Suspense fallback={<div className="page"><div className="empty">Wird geladen …</div></div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/notes" element={<NotesPage key="all" variant="all" />} />
              <Route path="/ink" element={<NotesPage key="ink" variant="ink" />} />
              <Route path="/meetings" element={<Navigate to="/notes" replace />} />
              <Route path="/archive" element={<NotesPage key="archive" variant="archive" />} />
              <Route path="/trash" element={<NotesPage key="trash" variant="trash" />} />
              <Route path="/note/:id" element={<NoteEditorPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </Suspense>
          </RouteBoundary>
        </Layout>
      </LockGate>
      <GlobalUI />
      <FileSaveUI />
      <UpdatePrompt />
    </HashRouter>
  );
}
