// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc, noteToMarkdown } from '../lib/markdown';
import type { Note } from '../db/types';

const md = `# Projektstatus

## Offene Punkte

Text mit **fett**, *kursiv*, ~~durch~~ und [Link](https://example.org).

- Punkt eins
- Punkt zwei

1. Erstens
2. Zweitens

- [ ] Offen
- [x] Erledigt

> Zitat

| Position | Betrag |
| --- | --- |
| Lizenzen | 12.500 € |

---

\`\`\`
code()
\`\`\``;

describe('Markdown', () => {
  it('liest Markdown ein und erzeugt die passenden Blöcke', () => {
    const { title, doc, text } = markdownToDoc(md);
    expect(title).toBe('Projektstatus');
    const types = doc.content!.map((b) => b.type);
    expect(types).toEqual([
      'heading', 'paragraph', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'table', 'horizontalRule', 'codeBlock'
    ]);
    const task = doc.content![4].content!;
    expect(task.map((t) => t.attrs?.checked)).toEqual([false, true]);
    expect(text).toContain('Lizenzen');
    const para = doc.content![1].content!;
    expect(para.find((n) => n.text === 'fett')?.marks?.[0].type).toBe('bold');
    expect(para.find((n) => n.text === 'Link')?.marks?.[0].attrs?.href).toBe('https://example.org');
  });

  it('Rundreise Markdown → Dokument → Markdown bleibt stabil', () => {
    const { doc } = markdownToDoc(md);
    const out = docToMarkdown(doc);
    const again = docToMarkdown(markdownToDoc('# Projektstatus\n\n' + out).doc);
    expect(again).toBe(out);
    expect(out).toContain('- [x] Erledigt');
    expect(out).toContain('| Lizenzen | 12.500 € |');
  });

  it('exportiert Notizen mit Aufgaben', () => {
    const note: Note = {
      id: 'm', type: 'text', title: 'Lenkungskreis', excerpt: '', categoryId: null, projectId: null, folderId: null, tags: ['ppwr'],
      pinned: 0, archived: 0, archivedAt: 0, deletedAt: 0, createdAt: 0, updatedAt: 0
    };
    const out = noteToMarkdown(note, { type: 'doc', content: [] }, [
      { id: 't', title: 'Liste', description: '', dueDate: '2026-11-07', priority: 1, status: 'open', noteId: 'm', projectId: null, categoryId: null, assignee: 'Anna', createdAt: 0, updatedAt: 0, completedAt: 0, deletedAt: 0 }
    ], { project: 'PPWR' });
    expect(out).toContain('# Lenkungskreis');
    expect(out).toContain('#ppwr');
    expect(out).toContain('- [ ] Liste (verantwortlich: Anna, fällig: 07.11.2026');
  });
});
