import { jsPDF } from 'jspdf';
import type { JSONContent } from '@tiptap/react';
import type { Note, Task } from '../db/types';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from '../db/types';
import { fmtDate, fmtDateTime } from './util';

/**
 * Erzeugt ein Text-PDF (durchsuchbar, scharf) aus einer Notiz.
 * Verwendet die PDF-Standardschriften (Helvetica/Courier) mit WinAnsi-Zeichensatz – Umlaute und ß sind enthalten.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 56; // Rand
const CONTENT_W = PAGE_W - 2 * M;

// Zeichen außerhalb von Windows-1252 werden ersetzt (z. B. Emojis)
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function sanitize(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 9) out += '    ';
    else if ((c >= 32 && c < 127) || (c >= 160 && c <= 255) || CP1252_EXTRA.includes(ch)) out += ch;
    else if (c === 0x2192) out += '->';
    else if (c === 0x2713 || c === 0x2714) out += 'x';
    else if (c > 0xffff || (c >= 0x2600 && c <= 0x27bf)) out += '';
    else out += '?';
  }
  return out;
}

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
  strike?: boolean;
  highlight?: boolean;
}

function runsOf(nodes: JSONContent[] | undefined, out: Run[] = []): Run[] {
  for (const n of nodes ?? []) {
    if (n.type === 'text') {
      const has = (m: string) => n.marks?.some((x) => x.type === m);
      const link = n.marks?.find((x) => x.type === 'link')?.attrs?.href as string | undefined;
      out.push({ text: sanitize(n.text ?? ''), bold: has('bold'), italic: has('italic'), code: has('code'), strike: has('strike'), highlight: has('highlight'), link });
    } else if (n.type === 'hardBreak') out.push({ text: '\n' });
    else runsOf(n.content, out);
  }
  return out;
}

class Writer {
  pdf: jsPDF;
  y = M;
  page = 1;
  constructor(private title: string) {
    this.pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    this.pdf.setProperties({ title, creator: 'TE Notes – TE Digital' });
  }

  ensure(h: number) {
    if (this.y + h > PAGE_H - M) this.newPage();
  }
  newPage() {
    this.pdf.addPage();
    this.page++;
    this.y = M;
  }

  font(r: Run, size: number) {
    const style = r.bold && r.italic ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal';
    this.pdf.setFont(r.code ? 'courier' : 'helvetica', style);
    this.pdf.setFontSize(r.code ? size * 0.92 : size);
  }

  /** Fließtext mit gemischten Auszeichnungen und automatischem Umbruch */
  paragraph(runs: Run[], opts: { size?: number; x?: number; width?: number; color?: [number, number, number]; lineGap?: number } = {}) {
    const size = opts.size ?? 11;
    const x0 = opts.x ?? M;
    const width = opts.width ?? CONTENT_W - (x0 - M);
    const lh = size * (opts.lineGap ?? 1.45);
    const color = opts.color ?? [29, 29, 31];
    // In Wörter mit Stil zerlegen
    type Word = { text: string; run: Run; space: boolean; br?: boolean };
    const words: Word[] = [];
    for (const r of runs) {
      if (r.text === '\n') {
        words.push({ text: '', run: r, space: false, br: true });
        continue;
      }
      const parts = r.text.split(/(\s+)/);
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) {
          if (words.length) words[words.length - 1].space = true;
        } else words.push({ text: p, run: r, space: false });
      }
    }
    if (!words.length) {
      this.y += lh * 0.6;
      return;
    }
    let line: Word[] = [];
    let lineW = 0;
    const flush = () => {
      this.ensure(lh);
      let x = x0;
      for (const w of line) {
        this.font(w.run, size);
        const tw = this.pdf.getTextWidth(w.text);
        if (w.run.highlight) {
          this.pdf.setFillColor(251, 231, 161);
          this.pdf.rect(x - 1, this.y - size * 0.82, tw + 2, size * 1.1, 'F');
        }
        if (w.run.link) this.pdf.setTextColor(47, 95, 179);
        else this.pdf.setTextColor(...color);
        this.pdf.text(w.text, x, this.y);
        if (w.run.link) this.pdf.link(x, this.y - size, tw, size * 1.2, { url: w.run.link });
        if (w.run.strike) {
          this.pdf.setDrawColor(...color);
          this.pdf.setLineWidth(0.6);
          this.pdf.line(x, this.y - size * 0.3, x + tw, this.y - size * 0.3);
        }
        x += tw;
        if (w.space) {
          this.font(w.run, size);
          x += this.pdf.getTextWidth(' ');
        }
      }
      this.y += lh;
      line = [];
      lineW = 0;
    };
    this.y += size * 0.9; // Grundlinie
    for (const w of words) {
      if (w.br) {
        flush();
        continue;
      }
      this.font(w.run, size);
      let tw = this.pdf.getTextWidth(w.text);
      const sw = w.space ? this.pdf.getTextWidth(' ') : 0;
      // Sehr lange Wörter (URLs) hart umbrechen
      if (tw > width) {
        let rest = w.text;
        while (rest) {
          let n = rest.length;
          while (n > 1 && this.pdf.getTextWidth(rest.slice(0, n)) > width - lineW) n--;
          line.push({ text: rest.slice(0, n), run: w.run, space: false });
          rest = rest.slice(n);
          if (rest) flush();
          else lineW += this.pdf.getTextWidth(line[line.length - 1].text);
        }
        line[line.length - 1].space = w.space;
        lineW += sw;
        continue;
      }
      if (lineW + tw > width && line.length) flush();
      line.push(w);
      lineW += tw + sw;
      tw = 0;
    }
    if (line.length) flush();
    this.y -= size * 0.9 - size * 0.35;
  }

  heading(text: string, level: number) {
    const size = level === 1 ? 18 : level === 2 ? 15 : 13;
    this.ensure(size * 3);
    this.y += size * 0.6;
    this.paragraph([{ text: sanitize(text), bold: true }], { size, lineGap: 1.25 });
    this.y += 2;
  }

  rule() {
    this.ensure(16);
    this.y += 6;
    this.pdf.setDrawColor(205, 202, 196);
    this.pdf.setLineWidth(0.7);
    this.pdf.line(M, this.y, PAGE_W - M, this.y);
    this.y += 10;
  }

  async image(src: string) {
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      let w = Math.min(CONTENT_W, img.naturalWidth * 0.75);
      let h = (w * img.naturalHeight) / img.naturalWidth;
      const maxH = PAGE_H - 2 * M;
      if (h > maxH) {
        h = maxH;
        w = (h * img.naturalWidth) / img.naturalHeight;
      }
      this.ensure(h + 8);
      const fmt = src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      let data = src;
      if (!/^data:image\/(png|jpe?g)/.test(src)) {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        data = c.toDataURL('image/jpeg', 0.9);
      }
      this.pdf.addImage(data, data === src ? fmt : 'JPEG', M, this.y + 4, w, h, undefined, 'FAST');
      this.y += h + 12;
    } catch {
      this.paragraph([{ text: '[Bild konnte nicht eingebettet werden]', italic: true }], { color: [140, 140, 140] });
    }
  }

  table(rows: Run[][][], headerRow: boolean) {
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.length));
    const cw = CONTENT_W / cols;
    const size = 10;
    const pad = 5;
    this.y += 4;
    rows.forEach((row, ri) => {
      // Zeilenhöhe durch Probelauf bestimmen
      const heights = row.map((cell) => {
        const text = cell.map((r) => r.text).join('');
        this.pdf.setFont('helvetica', ri === 0 && headerRow ? 'bold' : 'normal');
        this.pdf.setFontSize(size);
        return this.pdf.splitTextToSize(text || ' ', cw - 2 * pad).length * size * 1.35 + 2 * pad;
      });
      const h = Math.max(...heights, size + 2 * pad);
      this.ensure(h);
      for (let ci = 0; ci < cols; ci++) {
        const x = M + ci * cw;
        if (ri === 0 && headerRow) {
          this.pdf.setFillColor(243, 242, 238);
          this.pdf.rect(x, this.y, cw, h, 'F');
        }
        this.pdf.setDrawColor(190, 187, 180);
        this.pdf.setLineWidth(0.6);
        this.pdf.rect(x, this.y, cw, h);
        const text = (row[ci] ?? []).map((r) => r.text).join('');
        this.pdf.setFont('helvetica', ri === 0 && headerRow ? 'bold' : 'normal');
        this.pdf.setFontSize(size);
        this.pdf.setTextColor(29, 29, 31);
        const lines = this.pdf.splitTextToSize(text, cw - 2 * pad) as string[];
        lines.forEach((l, li) => this.pdf.text(l, x + pad, this.y + pad + size * 0.9 + li * size * 1.35));
      }
      this.y += h;
    });
    this.y += 10;
  }

  checkbox(x: number, checked: boolean) {
    this.pdf.setDrawColor(120, 120, 120);
    this.pdf.setLineWidth(0.8);
    this.pdf.roundedRect(x, this.y + 2.5, 9, 9, 1.5, 1.5);
    if (checked) {
      this.pdf.setDrawColor(46, 125, 91);
      this.pdf.setLineWidth(1.4);
      this.pdf.line(x + 1.8, this.y + 7, x + 4, this.y + 9.5);
      this.pdf.line(x + 4, this.y + 9.5, x + 7.8, this.y + 4);
    }
  }

  async blocks(nodes: JSONContent[] | undefined, indent = 0) {
    for (const n of nodes ?? []) await this.block(n, indent);
  }

  async block(n: JSONContent, indent: number) {
    const x = M + indent;
    switch (n.type) {
      case 'paragraph': {
        const runs = runsOf(n.content);
        const imgs = (n.content ?? []).filter((c) => c.type === 'image');
        if (runs.length || !imgs.length) this.paragraph(runs, { x });
        for (const im of imgs) await this.image(im.attrs?.src);
        this.y += 5;
        break;
      }
      case 'heading':
        this.heading(runsOf(n.content).map((r) => r.text).join(''), n.attrs?.level ?? 1);
        break;
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        let i = n.attrs?.start ?? 1;
        for (const li of n.content ?? []) {
          this.ensure(16);
          const startY = this.y;
          this.pdf.setFont('helvetica', 'normal');
          this.pdf.setFontSize(11);
          this.pdf.setTextColor(29, 29, 31);
          if (n.type === 'bulletList') this.pdf.text('•', x + 4, this.y + 10);
          else if (n.type === 'orderedList') this.pdf.text(`${i++}.`, x, this.y + 10);
          else this.checkbox(x + 1, !!li.attrs?.checked);
          const [first, ...rest] = li.content ?? [];
          if (first) {
            this.paragraph(runsOf(first.content), {
              x: x + 18,
              color: n.type === 'taskList' && li.attrs?.checked ? [140, 140, 140] : undefined
            });
          }
          if (this.y === startY) this.y += 14;
          await this.blocks(rest, indent + 18);
          this.y += 3;
        }
        this.y += 4;
        break;
      }
      case 'blockquote': {
        const y0 = this.y;
        const p0 = this.page;
        await this.blocks(n.content, indent + 14);
        if (this.page === p0) {
          this.pdf.setDrawColor(205, 202, 196);
          this.pdf.setLineWidth(2);
          this.pdf.line(x + 3, y0 + 2, x + 3, this.y - 4);
        }
        break;
      }
      case 'codeBlock': {
        const text = sanitize((n.content ?? []).map((t) => t.text ?? '').join(''));
        this.pdf.setFont('courier', 'normal');
        this.pdf.setFontSize(9.5);
        const lines = text.split('\n').flatMap((l) => this.pdf.splitTextToSize(l || ' ', CONTENT_W - indent - 16) as string[]);
        for (const l of lines) {
          this.ensure(13);
          this.pdf.setFillColor(243, 242, 238);
          this.pdf.rect(x, this.y, CONTENT_W - indent, 13, 'F');
          this.pdf.setTextColor(50, 50, 50);
          this.pdf.text(l, x + 8, this.y + 9.5);
          this.y += 13;
        }
        this.y += 8;
        break;
      }
      case 'horizontalRule':
        this.rule();
        break;
      case 'image':
        await this.image(n.attrs?.src);
        break;
      case 'table': {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((cell) => runsOf(cell.content)));
        const header = n.content?.[0]?.content?.[0]?.type === 'tableHeader';
        this.table(rows, header);
        break;
      }
      default:
        await this.blocks(n.content, indent);
    }
  }

  meta(label: string, value: string) {
    this.paragraph([{ text: sanitize(label) + ' ', bold: true }, { text: sanitize(value) }], { size: 10, color: [80, 80, 80], lineGap: 1.3 });
  }

  section(title: string) {
    this.ensure(40);
    this.y += 14;
    this.pdf.setFont('helvetica', 'bold');
    this.pdf.setFontSize(9);
    this.pdf.setTextColor(140, 139, 133);
    this.pdf.text(sanitize(title.toUpperCase()), M, this.y + 8);
    this.y += 18;
  }

  footer() {
    const total = this.pdf.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      this.pdf.setPage(i);
      this.pdf.setFont('helvetica', 'normal');
      this.pdf.setFontSize(8);
      this.pdf.setTextColor(150, 150, 150);
      this.pdf.text(sanitize(this.title).slice(0, 90), M, PAGE_H - 30);
      this.pdf.text(`TE Notes · Seite ${i} von ${total}`, PAGE_W - M, PAGE_H - 30, { align: 'right' });
    }
  }
}

export async function noteToPdf(
  note: Note,
  doc: JSONContent | null,
  tasks: Task[],
  names: { project?: string; category?: string }
): Promise<Blob> {
  const title = note.title || 'Ohne Titel';
  const w = new Writer(title);
  w.paragraph([{ text: sanitize(title), bold: true }], { size: 22, lineGap: 1.2 });
  w.y += 4;
  const metaBits = [
    names.project && `Projekt: ${names.project}`,
    names.category && `Kategorie: ${names.category}`,
    note.tags.length ? note.tags.map((t) => '#' + t).join(' ') : '',
    `Geändert ${fmtDateTime(note.updatedAt)}`
  ].filter(Boolean) as string[];
  w.paragraph([{ text: sanitize(metaBits.join('   ·   ')) }], { size: 9, color: [130, 130, 130] });
  w.y += 4;
  w.rule();

  const m = note.meeting;
  if (note.type === 'meeting' && m) {
    w.meta('Datum:', fmtDateTime(m.date));
    if (m.location) w.meta('Ort:', m.location);
    if (m.topic) w.meta('Thema:', m.topic);
    if (m.participants.length) w.meta('Teilnehmer:', m.participants.join(', '));
    if (m.followUpDate) w.meta('Wiedervorlage:', fmtDate(m.followUpDate));
    w.section('Gesprächsnotizen');
  }
  if (doc) await w.blocks(doc.content);

  if (note.type === 'meeting' && m && m.decisions.filter(Boolean).length) {
    w.section('Entscheidungen');
    m.decisions.filter(Boolean).forEach((d, i) => {
      w.paragraph([{ text: `${i + 1}.  `, bold: true }, { text: sanitize(d) }]);
      w.y += 4;
    });
  }
  if (tasks.length) {
    w.section('Aufgaben');
    for (const t of tasks) {
      w.ensure(30);
      w.checkbox(M + 1, t.status === 'done');
      const extra = [t.assignee && `Verantwortlich: ${t.assignee}`, t.dueDate && `Fällig: ${fmtDate(t.dueDate)}`, `Priorität: ${PRIORITY_LABEL[t.priority]}`, TASK_STATUS_LABEL[t.status]]
        .filter(Boolean)
        .join(' · ');
      w.paragraph([{ text: sanitize(t.title), bold: true }], { x: M + 18 });
      w.paragraph([{ text: sanitize(extra) }], { x: M + 18, size: 9, color: [120, 120, 120] });
      w.y += 4;
    }
  }
  w.footer();
  return w.pdf.output('blob');
}
