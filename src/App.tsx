import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { GlobalUI, toast } from './components/ui';
import { FileSaveUI } from './components/FileSave';
import { LockGate } from './components/Lock';
import { useApplyTheme, useSettings } from './lib/hooks';
import { flushAll } from './lib/saver';
import Dashboard from './pages/Dashboard';
import NotesPage from './pages/NotesPage';

// Selten genutzte bzw. große Bereiche erst bei Bedarf laden (alle Dateien sind offline vorgehalten)
const NoteEditorPage = lazy(() => import('./pages/NoteEditorPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const ProjectDetail = lazy(() => import('./pages/ProjectsPage').then((m) => ({ default: m.ProjectDetail })));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function FlushOnNavigate() {
  const location = useLocation();
  useEffect(() => () => flushAll(), [location.pathname]);
  return null;
}

function UpdatePrompt() {
  const [update, setUpdate] = useState<null | (() => void)>(null);
  useEffect(() => {
    const on = (e: Event) => setUpdate(() => (e as CustomEvent<() => void>).detail);
    window.addEventListener('te-sw-update', on);
    window.addEventListener('te-sw-offline-ready', () => toast('TE Notes ist jetzt offline verfügbar'));
    return () => window.removeEventListener('te-sw-update', on);
  }, []);
  if (!update) return null;
  return (
    <div className="update-bar" role="status">
      <span>Eine neue Version von TE Notes ist verfügbar.</span>
      <button
        className="btn btn-sm btn-primary"
        onClick={() => {
          flushAll();
          setTimeout(update, 300);
        }}
      >
        Aktualisieren
      </button>
      <button className="btn btn-sm btn-ghost" onClick={() => setUpdate(null)}>Später</button>
    </div>
  );
}

/** Editor & Seiten vorab laden, damit „Neue Notiz“ ohne Verzögerung öffnet (schnelles Erfassen) */
function usePrefetch() {
  useEffect(() => {
    const t = setTimeout(() => {
      void import('./pages/NoteEditorPage');
      void import('./pages/TasksPage');
      void import('./pages/SearchPage');
      void import('./pages/ProjectsPage');
      void import('./pages/SettingsPage');
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
          <Suspense fallback={<div className="page" />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/notes" element={<NotesPage key="all" variant="all" />} />
              <Route path="/ink" element={<NotesPage key="ink" variant="ink" />} />
              <Route path="/meetings" element={<NotesPage key="meetings" variant="meetings" />} />
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
        </Layout>
      </LockGate>
      <GlobalUI />
      <FileSaveUI />
      <UpdatePrompt />
    </HashRouter>
  );
}
