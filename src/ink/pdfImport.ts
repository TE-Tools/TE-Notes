/** Rendert PDF-Seiten lokal (pdf.js, ohne Server) zu Bildern, die als Schreibunterlage dienen. */

export interface RenderedPdfPage {
  blob: Blob;
  width: number; // Seitenbreite in Seiteneinheiten (immer 794 = A4-Breite)
  height: number;
}

const PAGE_W = 794;
const RENDER_W = 1700; // Pixelbreite des Hintergrundbilds (≈ 2× für scharfe Darstellung)

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function renderPdf(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
  maxPages = 300
): Promise<RenderedPdfPage[]> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const total = Math.min(doc.numPages, maxPages);
  const out: RenderedPdfPage[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = RENDER_W / base.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // intent 'print': rendert ohne requestAnimationFrame – läuft auch weiter, wenn die App kurz im Hintergrund ist
      await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Seite konnte nicht gerendert werden'))), 'image/jpeg', 0.88));
      // Speicher sofort freigeben (wichtig auf iPad)
      canvas.width = canvas.height = 0;
      page.cleanup();
      out.push({ blob, width: PAGE_W, height: Math.round((PAGE_W * base.height) / base.width) });
      onProgress?.(i, total);
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
