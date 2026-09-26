import type { APIRoute } from 'astro';
import { commitOp, storeInfo } from '../../../lib/admin/store';
import { rawWireItems } from '../../../lib/wire';
import { EditorialError } from '../../../../scripts/lib/editorial.mjs';

export const prerender = false;

const knownIds = new Set(rawWireItems.map((i) => i.id));

export const POST: APIRoute = async ({ request }) => {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const { op, summary } = payload ?? {};
  try {
    const { doc, commitUrl } = await commitOp(op, knownIds, String(summary || op?.type || 'edit').slice(0, 120));
    const story = op?.type === 'addManual' ? doc.manual[0] : undefined;
    return Response.json({ ok: true, mode: storeInfo().mode, commitUrl, id: story?.id });
  } catch (err: any) {
    const status = err instanceof EditorialError ? 400 : 502;
    return Response.json({ error: err?.message ?? 'Save failed' }, { status });
  }
};
