import { db } from '../db/db';
import { loadBitmap } from '../lib/images';

/**
 * Cache für dekodierte Bilder (PDF-Hintergründe, eingefügte Bilder).
 * Begrenzt auf eine feste Anzahl, da dekodierte Bitmaps auf dem iPad viel Arbeitsspeicher belegen.
 */
export class BitmapCache {
  private map = new Map<string, CanvasImageSource>();
  private loading = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  constructor(private max = 14, private onLoad?: () => void) {}

  /** Map-Sicht für die Zeichenfunktionen */
  get view(): Map<string, CanvasImageSource> {
    return this.map;
  }

  has(id: string) {
    return this.map.has(id);
  }

  /** Stellt sicher, dass die angegebenen IDs geladen werden; entfernt nicht benötigte, wenn voll */
  want(ids: string[]) {
    const keep = new Set(ids);
    for (const id of ids) {
      if (this.map.has(id)) {
        // als zuletzt verwendet markieren
        const v = this.map.get(id)!;
        this.map.delete(id);
        this.map.set(id, v);
      } else if (!this.loading.has(id) && !this.failed.has(id)) this.load(id);
    }
    while (this.map.size > this.max) {
      const oldest = [...this.map.keys()].find((k) => !keep.has(k));
      if (!oldest) break;
      const v = this.map.get(oldest);
      if (v && 'close' in (v as ImageBitmap)) (v as ImageBitmap).close();
      this.map.delete(oldest);
    }
  }

  private load(id: string) {
    const p = (async () => {
      try {
        const att = await db.attachments.get(id);
        if (!att) throw new Error('Anhang fehlt');
        const bmp = await loadBitmap(att.blob);
        this.map.set(id, bmp as CanvasImageSource);
        this.onLoad?.();
      } catch (e) {
        console.warn('Bild konnte nicht geladen werden', id, e);
        this.failed.add(id);
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, p);
  }

  /** Alle angeforderten Bilder laden und warten (für Export) */
  async loadAll(ids: string[]) {
    for (const id of ids) {
      if (this.map.has(id)) continue;
      const att = await db.attachments.get(id);
      if (!att) continue;
      this.map.set(id, (await loadBitmap(att.blob)) as CanvasImageSource);
    }
  }

  clear() {
    for (const v of this.map.values()) if ('close' in (v as ImageBitmap)) (v as ImageBitmap).close();
    this.map.clear();
  }
}
