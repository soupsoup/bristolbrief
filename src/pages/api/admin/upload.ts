import type { APIRoute } from 'astro';
import { saveUpload } from '../../../lib/admin/store';

export const prerender = false;

const MAX_BYTES = 3 * 1024 * 1024;

// Identify the image by its first bytes rather than trusting the client.
function sniff(buf: Buffer) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  let data: Buffer;
  let name = '';
  try {
    const body = await request.json();
    data = Buffer.from(String(body.data ?? '').replace(/^data:[^,]+,/, ''), 'base64');
    name = String(body.name ?? '');
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  if (!data.length) return Response.json({ error: 'No image received' }, { status: 400 });
  if (data.length > MAX_BYTES) return Response.json({ error: 'Photo is larger than 3 MB after resizing' }, { status: 413 });
  const ext = sniff(data);
  if (!ext) return Response.json({ error: 'Only JPEG, PNG or WebP photos are allowed' }, { status: 415 });
  try {
    const path = await saveUpload(data, ext, name.replace(/\.[a-z0-9]+$/i, ''));
    return Response.json({ ok: true, path });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? 'Upload failed' }, { status: 502 });
  }
};
