import type { APIRoute } from 'astro';
import { commitOp, storeInfo } from '../../../lib/admin/store';
import { allWireItems } from '../../../lib/wire';
import { EditorialError } from '../../../../scripts/lib/editorial.mjs';
import { parseSocialUrl, fetchOembed } from '../../../../scripts/lib/social.mjs';

// Fill in a social post's text and author from the platform when the editor
// didn't supply them. Fields the editor filled in win.
async function enrichSocial(op: any) {
  let parsed;
  try {
    parsed = parseSocialUrl(op.post?.url);
  } catch {
    return op; // applyOp reports the bad link
  }
  const given = Object.fromEntries(Object.entries(op.post ?? {}).filter(([, v]) => v !== '' && v != null));
  if (given.text && (parsed.platform !== 'bluesky' || given.uri)) return op;
  const info = await fetchOembed(parsed);
  return { ...op, post: { ...(info ?? {}), ...given } };
}

export const prerender = false;

const knownIds = new Set(allWireItems.map((i) => i.id));

export const POST: APIRoute = async ({ request }) => {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  let { op, summary } = payload ?? {};
  try {
    if (op?.type === 'addSocial') op = await enrichSocial(op);
    const { doc, commitUrl } = await commitOp(op, knownIds, String(summary || op?.type || 'edit').slice(0, 120));
    const story = op?.type === 'addManual' ? doc.manual[0] : undefined;
    return Response.json({ ok: true, mode: storeInfo().mode, commitUrl, id: story?.id });
  } catch (err: any) {
    const status = err instanceof EditorialError ? 400 : 502;
    return Response.json({ error: err?.message ?? 'Save failed' }, { status });
  }
};
