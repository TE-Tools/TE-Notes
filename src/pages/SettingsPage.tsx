import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileText, HardDrive, Lock, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { db, DB_SCHEMA_VERSION } from '../db/db';
import {
  createNote, deleteCategory, deleteFolder, rebuildSearchIndex, saveCategory, saveFolder, setSetting, type AppSettings
} from '../db/repo';
import { useLookups, useSettings } from '../lib/hooks';
import { COLORS, fmtBytes, fmtDateTime } from '../lib/util';
import {
  analyzeImport, applyImport, BackupError, backupFileName, defaultChoice, exportFullBackup, parseBackup,
  type ImportAnalysis, type ImportMode, type ParsedBackup
} from '../lib/backup';
import { markdownToDoc } from '../lib/markdown';
import { pickFiles, saveFile } from '../components/FileSave';
import { confirmDialog, Modal, promptDialog, Switch, toast, toastError } from '../components/ui';
import { disableLock, enableLock, lockApp } from '../components/Lock';
import { SidebarToggle } from '../components/Layout';
import { APP_CLAIM, APP_VERSION, BRAND } from '../lib/version';
import { tokenize } from '../lib/text';
import type { Note, NoteBody, SearchEntry } from '../db/types';
import { uid } from '../lib/util';

export default function SettingsPage() {
  const s = useSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [importState, setImportState] = useState<{ parsed: ParsedBackup; analysis: ImportAnalysis; fileName: string } | null>(null);
  const [pinModal, setPinModal] = useState(false);

  useEffect(() => {
    if (location.hash === '#backup') document.getElementById('backup')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  const backupNow = async () => {
    setBusy('backup');
    try {
      const blob = await exportFullBackup();
      setBusy(null);
      const saved = await saveFile(blob, backupFileName('full'), {
        title: 'Datensicherung bereit',
        hint: 'Tipp für das iPad: „Teilen / In Dateien sichern“ wählen und einen Ordner in der Dateien-App auswählen, z. B. „Auf meinem iPad“ oder einen USB-Stick.'
      });
      if (saved) {
        await setSetting('lastBackupAt', Date.now());
        toast('Sicherung erstellt');
      }
    } catch (e) {
      setBusy(null);
      toastError(e, 'Sicherung fehlgeschlagen');
    }
  };

  const importBackup = async () => {
    const [file] = await pickFiles('.tenotes,.zip,application/zip,application/octet-stream');
    if (!file) return;
    setBusy('import');
    try {
      const parsed = await parseBackup(file);
      const analysis = await analyzeImport(parsed);
      setImportState({ parsed, analysis, fileName: file.name });
    } catch (e) {
      toast(e instanceof BackupError ? e.message : 'Die Datei konnte nicht gelesen werden: ' + (e as Error).message, { kind: 'error', ms: 8000 });
    } finally {
      setBusy(null);
    }
  };

  const importMarkdown = async () => {
    const files = await pickFiles('.md,.markdown,.txt,text/markdown,text/plain', true);
    let last = '';
    for (const f of files) {
      try {
        const { title, doc, text } = markdownToDoc(await f.text());
        last = await createNote('text', { title: title || f.name.replace(/\.(md|markdown|txt)$/i, ''), doc, text });
      } catch (e) {
        toastError(e, `„${f.name}“ konnte nicht importiert werden`);
      }
    }
    if (files.length === 1 && last) navigate(`/note/${last}`);
    else if (files.length > 1) toast(`${files.length} Markdown-Dateien importiert`);
  };

  const lastBackupText = s.lastBackupAt ? fmtDateTime(s.lastBackupAt) : 'Noch keine Sicherung';
  const backupOld = !s.lastBackupAt || Date.now() - s.lastBackupAt > Math.max(1, s.backupReminderDays) * 86400000;

  return (
    <div className="page">
      <div className="page-narrow" style={{ maxWidth: 820 }}>
        <div className="page-header">
          <div className="row" style={{ gap: 6 }}>
            <span className="show-mobile" style={{ marginLeft: -10 }}>
              <SidebarToggle />
            </span>
            <div>
              <h1 className="page-title">Einstellungen</h1>
              <p className="page-sub">Alle Einstellungen und Daten bleiben auf diesem Gerät.</p>
            </div>
          </div>
        </div>

        <div className="settings-group">
          <h2>Allgemein</h2>
          <div className="card">
            <div className="setting">
              <div className="setting-main">
                <div className="setting-title">Ihr Name</div>
                <div className="setting-desc">Für die Begrüßung auf dem Dashboard</div>
              </div>
              <input className="input" style={{ width: 220 }} defaultValue={s.userName} key={s.userName} onBlur={(e) => setSetting('userName', e.target.value.trim())} placeholder="Vorname" />
            </div>
            <div className="setting">
              <div className="setting-main">
                <div className="setting-title">Darstellung</div>
              </div>
              <div className="segmented">
                {(['system', 'light', 'dark'] as AppSettings['theme'][]).map((t) => (
                  <button key={t} className={s.theme === t ? 'active' : ''} onClick={() => setSetting('theme', t)}>
                    {t === 'system' ? 'Automatisch' : t === 'light' ? 'Hell' : 'Dunkel'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-group">
          <h2>Handschrift</h2>
          <div className="card">
            <div className="setting">
              <div className="setting-main">
                <div className="setting-title">Mit dem Finger zeichnen</div>
                <div className="setting-desc">
                  Aus (empfohlen mit Apple Pencil): Der Pencil schreibt, der Finger verschiebt und zoomt. An: Ein Finger zeichnet, zwei Finger navigieren.
                </div>
              </div>
              <Switch checked={s.fingerDraws} onChange={(v) => setSetting('fingerDraws', v)} label="Mit dem Finger zeichnen" />
            </div>
            <div className="setting">
              <div className="setting-main">
                <div className="setting-title">Standard-Papier für neue Seiten</div>
              </div>
              <select className="select" style={{ width: 'auto' }} value={s.defaultPageBackground} onChange={(e) => setSetting('defaultPageBackground', e.target.value as AppSettings['defaultPageBackground'])}>
                <option value="lines">Liniert</option>
                <option value="grid">Kariert</option>
                <option value="dots">Gepunktet</option>
                <option value="blank">Blanko</option>
              </select>
            </div>
          </div>
        </div>

        <NamedList kind="categories" />
        <NamedList kind="folders" />

        <div className="settings-group" id="backup">
          <h2>Datensicherung & Übertragung</h2>
          <div className="banner info" style={{ marginBottom: 12 }}>
            <HardDrive size={22} />
            <div className="banner-text">
              TE Notes speichert ausschließlich auf diesem Gerät. Es gibt <strong>keine automatische Synchronisation</strong> zwischen iPad und PC –
              jedes Gerät hat einen eigenen Datenbestand. Zur Übertragung eine Sicherung exportieren und auf dem anderen Gerät importieren.
            </div>
          </div>
          <div className="card">
            <div className="setting">
              <div className="setting-main">
                <div className="setting-title">Letzte Sicherung</div>
                <div className="setting-desc" style={backupOld ? { color: 'var(--warn)' } : undefined}>{lastBackupText}</div>
              </div>
              <button className="btn btn-primary" onClick={backupNow} disabled={busy === 'backup'}>
                <Download size={18} /> {busy === 'backup' ? 'Wird erstellt …' : 'Vollständige Sicherung'}
              </button>
            </div>
            <div className="setting">
              <div className="setting-main">
                <div className="setting-title">Erinnerung an Datensicherung</div>
                <div className="setting-desc">Hinweis auf dem Dashboard, wenn die letzte Sicherung älter ist</div>
              </div>
              <select className="select" style={{ width: 'auto' }} value={s.backupReminderDays} onChange={(e) => setSetting('backupReminderDays', Number(e.target.value))}>
                <option value={0}>Aus</option>
                <option value={1}>Täglich</option>
                <option value={3}>Alle 3 Tage</option>
                <option value={7}>Wöchentlich</option>
                <option value={14}>Alle 2 Wochen</option>
                <option value={30}>Monatlich</option>
              </select>
            </div>
            <div className="setting">
              <div className="setting-main">
                <div className="setting-title">Sicherung importieren oder wiederherstellen</div>
                <div className="setting-desc">TE-Notes-Datei (.tenotes) – vollständige Sicherung oder einzelne exportierte Notizen. Konflikte werden vorher geprüft.</div>
              </div>
              <button className="btn" onClick={importBackup} disabled={busy === 'import'}>
                <Upload size={18} /> {busy === 'import' ? 'Wird geprüft …' : 'Importieren …'}
              </button>
            </div>
            <div className="setting">
              <div className="setting-main">
                <div className="setting-title">Markdown importieren</div>
                <div className="setting-desc">.md-Dateien als neue Notizen übernehmen</div>
              </div>
              <button className="btn" onClick={importMarkdown}>
                <FileText size={18} /> Markdown …
              </button>
            </div>
          </div>
        </div>

        <div className="settings-group">
          <h2>App-Sperre</h2>
          <div className="card">
            <div className="setting">
              <div className="setting-main">
                <div className="setting-title">PIN-Sperre</div>
                <div className="setting-desc">Fragt beim Öffnen und nach Inaktivität nach einer PIN.</div>
              </div>
              <Switch
                checked={s.lockEnabled}
                onChange={async (v) => {
                  if (v) setPinModal(true);
                  else if (await confirmDialog({ title: 'App-Sperre deaktivieren?', confirmLabel: 'Deaktivieren' })) {
                    await disableLock();
                    toast('App-Sperre deaktiviert');
                  }
                }}
                label="PIN-Sperre"
              />
            </div>
            {s.lockEnabled && (
              <>
                <div className="setting">
                  <div className="setting-main">
                    <div className="setting-title">Sperren nach</div>
                    <div className="setting-desc">Zeit im Hintergrund, bevor erneut die PIN verlangt wird</div>
                  </div>
                  <select className="select" style={{ width: 'auto' }} value={s.lockTimeoutMin} onChange={(e) => setSetting('lockTimeoutMin', Number(e.target.value))}>
                    <option value={0}>Sofort</option>
                    <option value={1}>1 Minute</option>
                    <option value={5}>5 Minuten</option>
                    <option value={15}>15 Minuten</option>
                    <option value={60}>1 Stunde</option>
                  </select>
                </div>
                <div className="setting">
                  <div className="setting-main"><div className="setting-title">Jetzt sperren</div></div>
                  <button className="btn" onClick={lockApp}><Lock size={17} /> Sperren</button>
                </div>
                <div className="setting">
                  <div className="setting-main"><div className="setting-title">PIN ändern</div></div>
                  <button className="btn" onClick={() => setPinModal(true)}>Ändern …</button>
                </div>
              </>
            )}
            <div className="setting" style={{ alignItems: 'flex-start' }}>
              <ShieldAlert size={20} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 2 }} />
              <div className="setting-desc">
                <strong>Wichtig:</strong> Die App-Sperre schützt nur die Bedienoberfläche vor neugierigen Blicken. Sie ist <strong>keine
                Verschlüsselung</strong> – die Daten liegen unverschlüsselt im Browser-Speicher dieses Geräts. Schützen Sie Ihr Gerät zusätzlich mit
                Code bzw. Face ID / Windows Hello. Die PIN wird nicht mitgesichert.
              </div>
            </div>
          </div>
        </div>

        <StorageSection />

        <div className="settings-group">
          <h2>Über</h2>
          <div className="card card-pad">
            <div className="row" style={{ gap: 14 }}>
              <img src="./icons/icon-192.png" alt="" style={{ width: 52, height: 52, borderRadius: 13 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>TE Notes – {APP_CLAIM}</div>
                <div className="small muted">
                  Eine Marke von {BRAND} · Version {APP_VERSION} · Datenbankschema {DB_SCHEMA_VERSION} · Sicherungsformat 1
                </div>
              </div>
            </div>
            <p className="small" style={{ color: 'var(--text-2)', marginBottom: 0 }}>
              Datenschutz: Keine Benutzerkonten, kein Server, keine Cloud, kein Tracking, keine Telemetrie, keine KI-Dienste. TE Notes überträgt keine
              Daten an Dritte. Nach der ersten Installation funktioniert die App vollständig offline.
            </p>
          </div>
        </div>
      </div>

      {importState && <ImportDialog {...importState} onClose={() => setImportState(null)} onBackupFirst={backupNow} />}
      {pinModal && <PinSetup onClose={() => setPinModal(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NamedList({ kind }: { kind: 'categories' | 'folders' }) {
  const lookups = useLookups();
  const items: { id: string; name: string; color?: string }[] = kind === 'categories' ? lookups.categories : lookups.folders;
  const counts = useLiveQuery(async () => {
    const field = kind === 'categories' ? 'categoryId' : 'folderId';
    const map = new Map<string, number>();
    await db.notes.where('deletedAt').equals(0).each((n) => {
      const v = n[field];
      if (v) map.set(v, (map.get(v) ?? 0) + 1);
    });
    return map;
  }, [kind]);
  const label = kind === 'categories' ? 'Kategorie' : 'Ordner';
  const save = (id: string | undefined, name: string, color?: string) =>
    kind === 'categories' ? saveCategory({ id, name, ...(color ? { color } : {}) }) : saveFolder({ id, name });
  const remove = kind === 'categories' ? deleteCategory : deleteFolder;

  return (
    <div className="settings-group">
      <h2>{kind === 'categories' ? 'Kategorien' : 'Ordner'}</h2>
      <div className="card">
        {items.map((it) => (
          <div key={it.id} className="edit-list-row">
            {kind === 'categories' && (
              <label className="color-pick" style={{ background: it.color, width: 22, height: 22, position: 'relative', flexShrink: 0 }}>
                <select
                  aria-label="Farbe"
                  value={it.color}
                  onChange={(e) => save(it.id, it.name, e.target.value)}
                  style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }}
                >
                  {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            )}
            <input
              className="input"
              defaultValue={it.name}
              key={it.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== it.name) void save(it.id, v);
                else e.target.value = it.name;
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label={`${label} umbenennen`}
            />
            <span className="small muted nowrap">{counts?.get(it.id) ?? 0} Notizen</span>
            <button
              className="icon-btn sm"
              aria-label={`${label} löschen`}
              onClick={async () => {
                if (await confirmDialog({ title: `${label} „${it.name}“ löschen?`, text: 'Zugeordnete Notizen bleiben erhalten und verlieren nur die Zuordnung.', confirmLabel: 'Löschen', danger: true }))
                  await remove(it.id);
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
        <div className="edit-list-row">
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              const name = await promptDialog({ title: `Neue${kind === 'categories' ? ' Kategorie' : 'r Ordner'}`, label: 'Name', confirmLabel: 'Anlegen' });
              if (name) await save(undefined, name);
            }}
          >
            <Plus size={17} /> {kind === 'categories' ? 'Kategorie' : 'Ordner'} hinzufügen
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StorageSection() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState('');
  const counts = useLiveQuery(async () => ({
    notes: await db.notes.count(),
    tasks: await db.tasks.count(),
    attachments: await db.attachments.count(),
    testdata: await db.notes.where('tags').equals('testdaten').count()
  }), []);

  const refresh = async () => {
    try {
      const e = await navigator.storage?.estimate?.();
      if (e) setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 });
      setPersisted((await navigator.storage?.persisted?.()) ?? null);
    } catch {
      /* nicht unterstützt */
    }
  };
  useEffect(() => {
    refresh();
  }, [counts]);

  const generate = async () => {
    const n = 2000;
    if (!(await confirmDialog({ title: `${n} Testnotizen erzeugen?`, text: 'Für einen Leistungstest werden Beispielnotizen mit dem Tag #testdaten angelegt. Sie lassen sich hier wieder vollständig entfernen.', confirmLabel: 'Erzeugen' }))) return;
    setBusy('gen');
    try {
      const words = 'Angebot Lieferant Marge Planung Kunde Vertrag Termin Budget Rechnung Analyse Abstimmung Freigabe Prozess Bericht Ziel Risiko Maßnahme Workshop Übergabe Prüfung'.split(' ');
      const now = Date.now();
      const batch = 250;
      for (let start = 0; start < n; start += batch) {
        const notes: Note[] = [];
        const bodies: NoteBody[] = [];
        const idx: SearchEntry[] = [];
        for (let i = start; i < Math.min(n, start + batch); i++) {
          const id = uid();
          const w = (k: number) => words[(i * 7 + k * 13) % words.length];
          const title = `Testnotiz ${i + 1}: ${w(1)} ${w(2)}`;
          const text = Array.from({ length: 12 }, (_, k) => `${w(k)} ${w(k + 3)} ${w(k + 5)} für Projekt ${w(k + 7)}.`).join(' ');
          const ts = now - i * 3600_000;
          notes.push({ id, type: 'text' as const, title, excerpt: text.slice(0, 179), categoryId: null, projectId: null, folderId: null, tags: ['testdaten'], pinned: 0 as const, archived: 0 as const, archivedAt: 0, deletedAt: 0, createdAt: ts, updatedAt: ts });
          bodies.push({ id, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, text, updatedAt: ts });
          idx.push({ id: 'note:' + id, kind: 'note' as const, refId: id, words: tokenize(title, text, 'testdaten') });
        }
        await db.transaction('rw', db.notes, db.bodies, db.search, async () => {
          await db.notes.bulkAdd(notes);
          await db.bodies.bulkAdd(bodies);
          await db.search.bulkAdd(idx);
        });
      }
      toast(`${n} Testnotizen erzeugt`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };

  const removeTest = async () => {
    setBusy('rm');
    try {
      const ids = await db.notes.where('tags').equals('testdaten').primaryKeys();
      await db.transaction('rw', db.notes, db.bodies, db.search, async () => {
        await db.notes.bulkDelete(ids);
        await db.bodies.bulkDelete(ids);
        await db.search.bulkDelete(ids.map((i) => 'note:' + i));
      });
      toast('Testnotizen entfernt');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="settings-group">
      <h2>Speicher</h2>
      <div className="card">
        <div className="setting">
          <div className="setting-main">
            <div className="setting-title">Belegter Speicher</div>
            <div className="setting-desc">
              {counts ? `${counts.notes} Notizen · ${counts.tasks} Aufgaben · ${counts.attachments} Dateien/Bilder` : '…'}
              {est && ` · ${fmtBytes(est.usage)} von ca. ${fmtBytes(est.quota)} verfügbar`}
            </div>
          </div>
        </div>
        <div className="setting">
          <div className="setting-main">
            <div className="setting-title row" style={{ gap: 8 }}>
              {persisted ? <ShieldCheck size={18} style={{ color: 'var(--ok)' }} /> : <ShieldAlert size={18} style={{ color: 'var(--warn)' }} />}
              Dauerhafter Speicher {persisted ? 'aktiv' : persisted === false ? 'nicht bestätigt' : 'unbekannt'}
            </div>
            <div className="setting-desc">
              Verhindert, dass der Browser die Daten bei Speicherknappheit automatisch löscht. Auf dem iPad TE Notes über „Teilen → Zum Home-Bildschirm“
              installieren – installierte Web-Apps sind vor automatischem Löschen geschützt.
            </div>
          </div>
          {!persisted && (
            <button
              className="btn"
              onClick={async () => {
                const ok = await navigator.storage?.persist?.();
                setPersisted(!!ok);
                toast(ok ? 'Dauerhafter Speicher aktiviert' : 'Der Browser hat die Anfrage abgelehnt. Bitte die App installieren.');
              }}
            >
              Anfordern
            </button>
          )}
        </div>
        <div className="setting">
          <div className="setting-main">
            <div className="setting-title">Suchindex neu aufbauen</div>
            <div className="setting-desc">Nur nötig, falls Suchergebnisse unvollständig erscheinen</div>
          </div>
          <button
            className="btn"
            disabled={busy === 'idx'}
            onClick={async () => {
              setBusy('idx');
              try {
                await rebuildSearchIndex();
                toast('Suchindex neu aufgebaut');
              } finally {
                setBusy('');
              }
            }}
          >
            <RefreshCw size={17} /> {busy === 'idx' ? 'Läuft …' : 'Neu aufbauen'}
          </button>
        </div>
        <div className="setting">
          <div className="setting-main">
            <div className="setting-title">Leistungstest</div>
            <div className="setting-desc">2000 Testnotizen (#testdaten) erzeugen, um das Verhalten mit großem Datenbestand auf diesem Gerät zu prüfen.</div>
          </div>
          {counts?.testdata ? (
            <button className="btn btn-danger" onClick={removeTest} disabled={!!busy}>{busy === 'rm' ? 'Entferne …' : `${counts.testdata} entfernen`}</button>
          ) : (
            <button className="btn" onClick={generate} disabled={!!busy}>{busy === 'gen' ? 'Erzeuge …' : 'Erzeugen'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PinSetup({ onClose }: { onClose: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const valid = /^\d{4,8}$/.test(a) && a === b;
  return (
    <Modal
      title="PIN festlegen"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            onClick={async () => {
              await enableLock(a);
              toast('App-Sperre aktiviert');
              onClose();
            }}
          >
            Aktivieren
          </button>
        </>
      }
    >
      <p className="small" style={{ marginTop: 0, color: 'var(--text-2)' }}>
        4 bis 8 Ziffern. Die PIN lässt sich nicht wiederherstellen. Die Sperre ist keine Verschlüsselung.
      </p>
      <div className="field">
        <label htmlFor="pin1">PIN</label>
        <input id="pin1" className="input" type="password" inputMode="numeric" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, '').slice(0, 8))} autoFocus />
      </div>
      <div className="field">
        <label htmlFor="pin2">PIN wiederholen</label>
        <input id="pin2" className="input" type="password" inputMode="numeric" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, '').slice(0, 8))} />
      </div>
      {b.length >= 4 && a !== b && <div className="small" style={{ color: 'var(--danger)' }}>Die PINs stimmen nicht überein.</div>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const MODE_TEXT: Record<ImportMode, { title: string; desc: string }> = {
  'merge-newer': { title: 'Zusammenführen (empfohlen)', desc: 'Neue Einträge übernehmen. Bei Konflikten gewinnt die zuletzt geänderte Version.' },
  'keep-local': { title: 'Nur neue Einträge hinzufügen', desc: 'Vorhandene Einträge auf diesem Gerät bleiben unverändert.' },
  'prefer-incoming': { title: 'Version aus der Sicherung bevorzugen', desc: 'Neue Einträge übernehmen, bei Konflikten die Sicherung verwenden.' },
  replace: { title: 'Vollständige Wiederherstellung', desc: 'ALLE Daten auf diesem Gerät werden gelöscht und durch die Sicherung ersetzt.' }
};

function ImportDialog({
  parsed, analysis, fileName, onClose, onBackupFirst
}: { parsed: ParsedBackup; analysis: ImportAnalysis; fileName: string; onClose: () => void; onBackupFirst: () => void }) {
  const [mode, setMode] = useState<ImportMode>('merge-newer');
  const [choices, setChoices] = useState<Record<string, 'local' | 'incoming'>>({});
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = parsed.manifest;
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  const KIND_LABEL = { notes: 'Notiz', tasks: 'Aufgabe', projects: 'Projekt', categories: 'Kategorie', folders: 'Ordner' };
  const modes: ImportMode[] = m.scope === 'full' ? ['merge-newer', 'keep-local', 'prefer-incoming', 'replace'] : ['merge-newer', 'keep-local', 'prefer-incoming'];

  const run = async () => {
    setBusy(true);
    try {
      const r = await applyImport(parsed, mode, choices);
      toast(mode === 'replace' ? 'Sicherung vollständig wiederhergestellt' : `Import abgeschlossen: ${r.written} übernommen, ${r.skipped} unverändert`);
      onClose();
    } catch (e) {
      toastError(e, 'Import fehlgeschlagen – es wurden keine Daten verändert');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={m.scope === 'full' ? 'Sicherung importieren' : 'Notizen importieren'}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button
            className={'btn ' + (mode === 'replace' ? 'btn-danger-solid' : 'btn-primary')}
            disabled={busy || (mode === 'replace' && !confirmReplace)}
            onClick={run}
          >
            {busy ? 'Wird übernommen …' : mode === 'replace' ? 'Alles ersetzen' : 'Importieren'}
          </button>
        </>
      }
    >
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{fileName}</div>
        <div className="small muted">
          Erstellt {fmtDateTime(m.createdAt)} · TE Notes {m.appVersion} · {plural(m.counts.notes ?? 0, 'Notiz', 'Notizen')},{' '}
          {plural(m.counts.tasks ?? 0, 'Aufgabe', 'Aufgaben')}, {plural(m.counts.attachments ?? 0, 'Datei', 'Dateien')}
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <span className="chip ok">{sum(analysis.added)} neu</span>
        <span className="chip">{sum(analysis.identical)} identisch</span>
        <span className={'chip' + (analysis.conflicts.length ? ' warn' : '')}>{plural(analysis.conflicts.length, 'Konflikt', 'Konflikte')}</span>
      </div>

      <div className="label" style={{ marginBottom: 6 }}>Vorgehen</div>
      <div className="list" style={{ marginBottom: 14 }}>
        {modes.map((k) => (
          <label key={k} className="list-row" style={{ alignItems: 'flex-start' }}>
            <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} style={{ marginTop: 4, width: 18, height: 18, accentColor: 'var(--accent)' }} />
            <div className="list-row-main">
              <div style={{ fontWeight: 600, color: k === 'replace' ? 'var(--danger)' : undefined }}>{MODE_TEXT[k].title}</div>
              <div className="small" style={{ color: 'var(--text-2)', whiteSpace: 'normal' }}>{MODE_TEXT[k].desc}</div>
            </div>
          </label>
        ))}
      </div>

      {mode === 'replace' && (
        <div className="banner" style={{ background: 'var(--danger-soft)', borderColor: 'transparent' }}>
          <ShieldAlert size={22} style={{ color: 'var(--danger)' }} />
          <div className="banner-text">
            <label className="check">
              <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
              Ich verstehe, dass alle aktuellen Daten dieses Geräts ersetzt werden.
            </label>
          </div>
          <button className="btn btn-sm" onClick={onBackupFirst}>Vorher sichern</button>
        </div>
      )}

      {mode !== 'replace' && analysis.conflicts.length > 0 && (
        <>
          <div className="label" style={{ marginBottom: 6 }}>Konflikte – auf beiden Seiten geändert</div>
          <div className="list">
            {analysis.conflicts.map((c) => {
              const choice = choices[c.key] ?? defaultChoice(mode, c);
              return (
                <div key={c.key} className="list-row" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                  <div className="list-row-main" style={{ minWidth: 180 }}>
                    <div className="list-row-title">{c.title}</div>
                    <div className="list-row-sub">
                      {KIND_LABEL[c.kind]} · hier {fmtDateTime(c.localUpdatedAt)} · Sicherung {fmtDateTime(c.incomingUpdatedAt)}
                    </div>
                  </div>
                  <div className="segmented">
                    <button className={choice === 'local' ? 'active' : ''} onClick={() => setChoices((x) => ({ ...x, [c.key]: 'local' }))}>
                      Dieses Gerät{c.localUpdatedAt > c.incomingUpdatedAt ? ' (neuer)' : ''}
                    </button>
                    <button className={choice === 'incoming' ? 'active' : ''} onClick={() => setChoices((x) => ({ ...x, [c.key]: 'incoming' }))}>
                      Sicherung{c.incomingUpdatedAt > c.localUpdatedAt ? ' (neuer)' : ''}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
