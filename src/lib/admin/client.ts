// Browser helpers for the admin pages.

let toastTimer: number | undefined;

export function toast(message: string, { error = false, html = false } = {}) {
  const el = document.querySelector<HTMLElement>('.a-toast');
  if (!el) return alert(message);
  el.classList.toggle('error', error);
  if (html) el.innerHTML = message;
  else el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), error ? 9000 : 6000);
}

export interface OpResult {
  ok?: boolean;
  error?: string;
  mode?: 'github' | 'local';
  commitUrl?: string;
  id?: string;
}

/** Save one editorial operation. Resolves with the server's reply; shows a toast. */
export async function saveOp(op: Record<string, unknown>, summary: string): Promise<OpResult> {
  let res: Response;
  try {
    res = await fetch('/api/admin/op/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, summary }),
    });
  } catch {
    toast('Could not reach the server. Check your connection and try again.', { error: true });
    return { error: 'network' };
  }
  const body: OpResult = await res.json().catch(() => ({ error: `Save failed (${res.status})` }));
  if (!res.ok || body.error) {
    toast(body.error ?? `Save failed (${res.status})`, { error: true });
    return body;
  }
  toast(
    body.mode === 'github'
      ? 'Saved. The live site updates in about a minute.'
      : 'Saved to local files (not published).',
  );
  return body;
}

/** Resize a photo in the browser (longest side 1600px) and return a JPEG data URL. */
export async function resizeImage(file: File, max = 1600, quality = 0.85): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not an image the browser can read.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // flatten transparency for JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadImage(dataUrl: string, name: string): Promise<string | null> {
  const res = await fetch('/api/admin/upload/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: dataUrl, name }),
  });
  const body = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
  if (!res.ok || body.error) {
    toast(body.error ?? 'Upload failed', { error: true });
    return null;
  }
  return body.path;
}
