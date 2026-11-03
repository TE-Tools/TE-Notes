/** Bild laden und bei Bedarf verkleinern (spart Speicherplatz, Fotos vom iPad sind oft > 5 MB). */
export async function downscaleImage(file: Blob, maxDim = 2000, quality = 0.86): Promise<Blob> {
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
    closeBitmap(bmp);
    return file;
  }
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const keepAlpha = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp';
  if (!keepAlpha) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, w, h);
  closeBitmap(bmp);
  const type = keepAlpha ? 'image/png' : 'image/jpeg';
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
  canvas.width = canvas.height = 0;
  return out ?? file;
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

type Bitmapish = ImageBitmap | HTMLImageElement;

export async function loadBitmap(b: Blob): Promise<Bitmapish> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(b);
    } catch {
      /* Fallback unten (z. B. HEIC in älterem Safari) */
    }
  }
  const url = URL.createObjectURL(b);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function closeBitmap(b: Bitmapish) {
  if ('close' in b) b.close();
}

export function imageSize(b: Bitmapish) {
  return 'naturalWidth' in b ? { w: b.naturalWidth, h: b.naturalHeight } : { w: b.width, h: b.height };
}
