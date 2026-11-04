import type { JSONContent } from '@tiptap/react';

export type NoteType = 'text' | 'ink';

export interface Note {
  id: string;
  type: NoteType;
  title: string;
  /** Kurzer Textauszug für Listen (aus dem Inhalt erzeugt) */
  excerpt: string;
  categoryId: string | null;
  projectId: string | null;
  folderId: string | null;
  tags: string[];
  pinned: 0 | 1;
  archived: 0 | 1;
  archivedAt: number;
  /** 0 = nicht gelöscht, sonst Zeitpunkt des Verschiebens in den Papierkorb */
  deletedAt: number;
  createdAt: number;
  updatedAt: number;
  inkPageCount?: number;
}

export interface NoteBody {
  id: string; // = noteId
  doc: JSONContent;
  text: string;
  updatedAt: number;
}

export type InkTool = 'pen' | 'highlighter';
export type PageBackground = 'blank' | 'lines' | 'grid' | 'dots';

export interface Stroke {
  id: string;
  tool: InkTool;
  color: string;
  size: number;
  /** Flache Liste: x, y, Druck, x, y, Druck, ... (Seitenkoordinaten) */
  points: number[];
  /** true, wenn kein echter Druck vorhanden war (Maus/Finger) */
  simulated: boolean;
}

export interface InkImage {
  id: string;
  attachmentId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InkPage {
  id: string;
  noteId: string;
  index: number;
  width: number;
  height: number;
  background: PageBackground;
  /** Hintergrund aus PDF-Import (gerendertes Seitenbild) */
  bgAttachmentId: string | null;
  strokes: Stroke[];
  images: InkImage[];
  /** Aufgabenbereich unten auf der Seite: je Zeile Kästchen + Schreiblinie */
  tasks?: InkTaskArea | null;
  updatedAt: number;
}

export interface InkTaskArea {
  rows: number;
  /** Abgehakte Zeilen (Index = Zeile) */
  checked: boolean[];
  /** In eine neue Seite/Notiz übernommene Zeilen (Pfeil statt Haken, zählen nicht mehr als offen) */
  carried?: boolean[];
}

export type AttachmentKind = 'file' | 'inkbg' | 'inkimg';

export interface Attachment {
  id: string;
  noteId: string | null;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
}

export type TaskStatus = 'open' | 'inprogress' | 'done' | 'deferred';
export type TaskPriority = 1 | 2 | 3; // 1 = hoch, 2 = mittel, 3 = niedrig

export interface Task {
  id: string;
  title: string;
  description: string;
  /** YYYY-MM-DD oder null */
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  noteId: string | null;
  projectId: string | null;
  categoryId: string | null;
  /** Verantwortliche Person */
  assignee: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number;
  deletedAt: number;
}

export type ProjectStatus = 'aktiv' | 'pausiert' | 'abgeschlossen';

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export interface SearchEntry {
  id: string; // kind:refId
  kind: 'note' | 'task';
  refId: string;
  words: string[];
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Offen',
  inprogress: 'In Bearbeitung',
  done: 'Erledigt',
  deferred: 'Zurückgestellt'
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = { 1: 'Hoch', 2: 'Mittel', 3: 'Niedrig' };

export const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  text: 'Notiz',
  ink: 'Handschrift'
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  aktiv: 'Aktiv',
  pausiert: 'Pausiert',
  abgeschlossen: 'Abgeschlossen'
};
