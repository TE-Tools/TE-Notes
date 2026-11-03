const DIACRITICS = /[̀-ͯ]/g;

/** Normalisiert Text für die Suche: Kleinschreibung, Umlaute/Akzente entfernt, ß → ss */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(DIACRITICS, '');
}

const MAX_WORDS = 4000;
const SPLIT = /[^\p{L}\p{N}]+/u;

/** Zerlegt Text in eindeutige, normalisierte Suchwörter */
export function tokenize(...parts: (string | undefined | null)[]): string[] {
  const set = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    for (const w of normalize(p).split(SPLIT)) {
      if (w.length < 2) continue;
      set.add(w.slice(0, 40));
      if (set.size >= MAX_WORDS) return [...set];
    }
  }
  return [...set];
}

/** Suchbegriffe: wie tokenize, aber auch einzelne Zeichen zulassen */
export function queryTokens(q: string): string[] {
  return [...new Set(normalize(q).split(SPLIT).filter((w) => w.length >= 1))];
}

export function makeExcerpt(text: string, len = 180): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > len ? t.slice(0, len - 1) + '…' : t;
}
