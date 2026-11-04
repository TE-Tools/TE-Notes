import type { JSONContent } from '@tiptap/react';
import type { Note, Task } from '../db/types';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from '../db/types';
import { fmtDate, fmtDateTime } from './util';

/* ------------------------------------------------------------------ */
/* TipTap-JSON → Markdown                                              */
/* ------------------------------------------------------------------ */

function inline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](${n.attrs?.src ?? ''})`;
      if (n.type !== 'text') return inline(n.content);
      let t = (n.text ?? '').replace(/([*_`[\]\\])/g, '\\$1');
      const marks = n.marks ?? [];
      const has = (m: string) => marks.some((x) => x.type === m);
      if (has('code')) t = '`' + (n.text ?? '') + '`';
      if (has('bold')) t = `**${t}**`;
      if (has('italic')) t = `*${t}*`;
      if (has('strike')) t = `~~${t}~~`;
      if (has('highlight')) t = `==${t}==`;
      const link = marks.find((x) => x.type === 'link');
      if (link) t = `[${t}](${link.attrs?.href ?? ''})`;
      return t;
    })
    .join('');
}

function block(n: JSONContent, indent = ''): string {
  const c = n.content ?? [];
  switch (n.type) {
    case 'paragraph':
      return indent + inline(c);
    case 'heading':
      return '#'.repeat(n.attrs?.level ?? 1) + ' ' + inline(c);
    case 'bulletList':
      return c.map((li) => listItem(li, indent, '- ')).join('\n');
    case 'orderedList':
      return c.map((li, i) => listItem(li, indent, `${(n.attrs?.start ?? 1) + i}. `)).join('\n');
    case 'taskList':
      return c.map((li) => listItem(li, indent, li.attrs?.checked ? '- [x] ' : '- [ ] ')).join('\n');
    case 'blockquote':
      return c.map((b) => block(b)).join('\n\n').split('\n').map((l) => '> ' + l).join('\n');
    case 'codeBlock':
      return '```' + (n.attrs?.language ?? '') + '\n' + c.map((t) => t.text ?? '').join('') + '\n```';
    case 'horizontalRule':
      return '---';
    case 'image':
      return `![${n.attrs?.alt ?? ''}](${n.attrs?.src ?? ''})`;
    case 'table': {
      const rows = c.map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((p) => inline(p.content)).join(' ').replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const cols = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => '| ' + Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ') + ' |';
      return [line(rows[0]), '|' + ' --- |'.repeat(cols), ...rows.slice(1).map(line)].join('\n');
    }
    default:
      return c.map((b) => block(b, indent)).join('\n\n');
  }
}

function listItem(li: JSONContent, indent: string, marker: string): string {
  const parts = li.content ?? [];
  const [first, ...rest] = parts;
  let out = indent + marker + (first ? inline(first.content) : '');
  for (const r of rest) out += '\n' + block(r, indent + '  ');
  return out;
}

export function docToMarkdown(doc: JSONContent): string {
  return (doc.content ?? []).map((b) => block(b)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function noteToMarkdown(note: Note, doc: JSONContent | null, tasks: Task[], names: { project?: string; category?: string; folder?: string }) {
  const lines: string[] = [];
  lines.push('# ' + (note.title || 'Ohne Titel'), '');
  const meta: string[] = [];
  if (names.project) meta.push(`**Projekt:** ${names.project}`);
  if (names.category) meta.push(`**Kategorie:** ${names.category}`);
  if (names.folder) meta.push(`**Ordner:** ${names.folder}`);
  if (note.tags.length) meta.push(`**Tags:** ${note.tags.map((t) => '#' + t).join(' ')}`);
  meta.push(`**Erstellt:** ${fmtDateTime(note.createdAt)} · **Geändert:** ${fmtDateTime(note.updatedAt)}`);
  lines.push(meta.join('  \n'), '');
  if (doc) lines.push(docToMarkdown(doc), '');
  if (tasks.length) {
    lines.push('## Aufgaben', '');
    for (const t of tasks) {
      const extra = [
        t.assignee && `verantwortlich: ${t.assignee}`,
        t.dueDate && `fällig: ${fmtDate(t.dueDate)}`,
        `Priorität: ${PRIORITY_LABEL[t.priority]}`,
        TASK_STATUS_LABEL[t.status]
      ].filter(Boolean);
      lines.push(`- [${t.status === 'done' ? 'x' : ' '}] ${t.title} (${extra.join(', ')})`);
    }
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

/* ------------------------------------------------------------------ */
/* Markdown → TipTap-JSON (für den Import einzelner .md-Dateien)       */
/* ------------------------------------------------------------------ */

const INLINE_RE = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|==[^=]+==|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/;

type Mark = { type: string; attrs?: Record<string, unknown> };

function parseInline(s: string, marks: Mark[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  let rest = s;
  while (rest) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      out.push(textNode(rest, marks));
      break;
    }
    if (m.index > 0) out.push(textNode(rest.slice(0, m.index), marks));
    const tok = m[0];
    if (tok.startsWith('**') || tok.startsWith('__')) out.push(...parseInline(tok.slice(2, -2), [...marks, { type: 'bold' }]));
    else if (tok.startsWith('~~')) out.push(...parseInline(tok.slice(2, -2), [...marks, { type: 'strike' }]));
    else if (tok.startsWith('==')) out.push(...parseInline(tok.slice(2, -2), [...marks, { type: 'highlight' }]));
    else if (tok.startsWith('`')) out.push(textNode(tok.slice(1, -1), [...marks, { type: 'code' }]));
    else if (tok.startsWith('![')) {
      const mm = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(tok)!;
      out.push({ type: 'image', attrs: { src: mm[2], alt: mm[1] } });
    } else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(...parseInline(mm[1], [...marks, { type: 'link', attrs: { href: mm[2] } }]));
    } else out.push(...parseInline(tok.slice(1, -1), [...marks, { type: 'italic' }]));
    rest = rest.slice(m.index + tok.length);
  }
  return out.filter((n) => n.type !== 'text' || n.text);
}

function textNode(text: string, marks: Mark[]): JSONContent {
  const t = text.replace(/\\([*_`[\]\\])/g, '$1');
  return marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t };
}

const para = (s: string): JSONContent => {
  const content = parseInline(s);
  // Bilder sind in TipTap Blockelemente
  if (content.length === 1 && content[0].type === 'image') return content[0];
  return content.length ? { type: 'paragraph', content: content.filter((c) => c.type !== 'image') } : { type: 'paragraph' };
};

export function markdownToDoc(md: string): { title: string; doc: JSONContent; text: string } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: JSONContent[] = [];
  let title = '';
  let i = 0;
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(3, h[1].length);
      if (!title && h[1].length === 1 && blocks.length === 0) title = h[2].trim();
      else blocks.push({ type: 'heading', attrs: { level }, content: parseInline(h[2]) });
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push({ type: 'codeBlock', attrs: { language: lang || null }, content: buf.length ? [{ type: 'text', text: buf.join('\n') }] : [] });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'horizontalRule' });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ type: 'blockquote', content: markdownToDoc(buf.join('\n')).doc.content });
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const rows: string[][] = [];
      const PIPE = '\u0001';
      const split = (l: string) =>
        l.trim().replace(/^\||\|$/g, '').replace(/\\\|/g, PIPE).split('|').map((c) => c.trim().split(PIPE).join('|'));
      rows.push(split(line));
      i += 2;
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(split(lines[i++]));
      blocks.push({
        type: 'table',
        content: rows.map((r, ri) => ({
          type: 'tableRow',
          content: r.map((cell) => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', content: [para(cell)] }))
        }))
      });
      continue;
    }
    if (listRe.test(line)) {
      const items: { task: boolean; checked: boolean; ordered: boolean; text: string }[] = [];
      while (i < lines.length && listRe.test(lines[i])) {
        const m = listRe.exec(lines[i])!;
        items.push({ task: !!m[3], checked: m[4] === 'x' || m[4] === 'X', ordered: /\d/.test(m[2]), text: m[5] });
        i++;
      }
      // Aufeinanderfolgende Einträge gleichen Typs gruppieren
      let k = 0;
      while (k < items.length) {
        const kind = items[k].task ? 'taskList' : items[k].ordered ? 'orderedList' : 'bulletList';
        const group: JSONContent[] = [];
        while (k < items.length && (items[k].task ? 'taskList' : items[k].ordered ? 'orderedList' : 'bulletList') === kind) {
          const it = items[k++];
          group.push(
            kind === 'taskList'
              ? { type: 'taskItem', attrs: { checked: it.checked }, content: [para(it.text)] }
              : { type: 'listItem', content: [para(it.text)] }
          );
        }
        blocks.push({ type: kind, content: group });
      }
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\|)/.test(lines[i]) && !listRe.test(lines[i])) buf.push(lines[i++]);
    const joined = buf.join('\n');
    const pieces = joined.split(/ {2}\n/);
    const content: JSONContent[] = [];
    pieces.forEach((p, idx) => {
      if (idx > 0) content.push({ type: 'hardBreak' });
      content.push(...parseInline(p.replace(/\n/g, ' ')));
    });
    const imgs = content.filter((c) => c.type === 'image');
    const rest = content.filter((c) => c.type !== 'image');
    if (rest.length) blocks.push({ type: 'paragraph', content: rest });
    blocks.push(...imgs);
  }
  const doc: JSONContent = { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
  return { title, doc, text: docText(doc) };
}

export function docText(doc: JSONContent): string {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'text') out.push(n.text ?? '');
    n.content?.forEach(walk);
    if (n.type && /paragraph|heading|listItem|taskItem|codeBlock|tableCell|tableHeader/.test(n.type)) out.push('\n');
  };
  walk(doc);
  return out.join('').replace(/\n{2,}/g, '\n').trim();
}
