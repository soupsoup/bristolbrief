import type { APIRoute } from 'astro';
import { parseSocialUrl, fetchOembed, SocialError } from '../../../../scripts/lib/social.mjs';

export const prerender = false;

// Look up a post's text and author before the editor saves it.
export const POST: APIRoute = async ({ request }) => {
  let url = '';
  try {
    url = String((await request.json())?.url ?? '');
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  let parsed;
  try {
    parsed = parseSocialUrl(url);
  } catch (err: any) {
    return Response.json({ error: err instanceof SocialError ? err.message : 'Invalid link' }, { status: 400 });
  }
  const info = await fetchOembed(parsed);
  return Response.json({ platform: parsed.platform, url: parsed.url, found: Boolean(info?.text), ...(info ?? {}) });
};
