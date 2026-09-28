import type { APIRoute } from 'astro';
import { subscribe } from '../../lib/newsletter';

export const prerender = false;

// A few tries per address per minute per server instance, to blunt scripted
// abuse. beehiiv also deduplicates.
const recent = new Map<string, number[]>();
function limited(key: string) {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > 5;
}

export const POST: APIRoute = async ({ request, clientAddress, redirect }) => {
  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  let email = '';
  let trap = '';
  try {
    if (isJson) {
      const body = await request.json();
      email = String(body?.email ?? '');
      trap = String(body?.website ?? '');
    } else {
      const form = await request.formData();
      email = String(form.get('email') ?? '');
      trap = String(form.get('website') ?? '');
    }
  } catch {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  email = email.trim().toLowerCase();
  // Bots fill the hidden "website" field; pretend it worked.
  const result = trap
    ? { ok: true as const }
    : limited(clientAddress || 'unknown')
      ? { ok: false as const, status: 429, error: 'upstream' as const }
      : await subscribe(email, { referrer: request.headers.get('referer') ?? '' });

  if (isJson) return Response.json(result.ok ? { ok: true } : { ok: false, error: result.error }, { status: result.ok ? 200 : result.status });
  // Without JavaScript the form posts here directly: send people to the subscribe page with a message.
  return redirect(`/subscribe/?status=${result.ok ? 'ok' : result.error}`, 303);
};
