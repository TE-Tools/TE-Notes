import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/db';
import { DEFAULT_SETTINGS, type AppSettings } from '../db/repo';
import type { Category, Folder, Project } from '../db/types';

export function useSettings(): AppSettings {
  const rows = useLiveQuery(() => db.settings.toArray(), []);
  return useMemo(() => {
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows ?? []) s[r.key] = r.value;
    return s as unknown as AppSettings;
  }, [rows]);
}

export interface Lookups {
  projects: Project[];
  categories: Category[];
  folders: Folder[];
  projectMap: Map<string, Project>;
  categoryMap: Map<string, Category>;
  folderMap: Map<string, Folder>;
}

export function useLookups(): Lookups {
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const folders = useLiveQuery(() => db.folders.toArray(), []) ?? [];
  return useMemo(() => {
    const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'de');
    const p = [...projects].sort(byName);
    const c = [...categories].sort(byName);
    const f = [...folders].sort(byName);
    return {
      projects: p, categories: c, folders: f,
      projectMap: new Map(p.map((x) => [x.id, x])),
      categoryMap: new Map(c.map((x) => [x.id, x])),
      folderMap: new Map(f.map((x) => [x.id, x]))
    };
  }, [projects, categories, folders]);
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** Wendet das Farbschema (hell/dunkel/System) auf <html> an */
export function useApplyTheme(theme: AppSettings['theme']) {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  useEffect(() => {
    const dark = theme === 'dark' || (theme === 'system' && systemDark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#1c1c1e' : '#f7f6f3'));
  }, [theme, systemDark]);
}

/** Datei als Object-URL bereitstellen und automatisch freigeben */
export function useObjectUrl(blob: Blob | undefined | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
