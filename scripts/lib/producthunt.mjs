// AI tools getting the most interest on Product Hunt, for the /tools/ page.
// Reads the public leaderboard through Product Hunt's MCP server (no sign-in needed
// for the leaderboard tool) and keeps the AI products with the most votes.

export const MCP_URL = 'https://mcp.producthunt.com/mcp';

const PT = 'America/Los_Angeles';
const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: PT });

/** ISO week label ("2026-W46") for the Pacific-time calendar day of `d`. */
export function isoWeek(d) {
  const [y, m, day] = ymd(d).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The periods to ask for: the last finished day, this week so far, and last week. */
export function periodsFor(now = new Date()) {
  const day = (back) => ymd(new Date(now.valueOf() - back * 864e5));
  return [day(1), isoWeek(now), isoWeek(new Date(now.valueOf() - 7 * 864e5))];
}

const AI_WORDS = /\b(?:ai|a\.i\.|llm|llms|gpt|chatgpt|claude|gemini|copilot|agent|agents|agentic|mcp|openai|anthropic|machine learning|generative)\b/i;

/** True when a product is an AI tool: an AI category, or AI words in its name, tagline or description. */
export function isAiTool(p) {
  if ((p.categories ?? []).some((c) => /(^|-)ai(-|$)/.test(c.slug ?? '') || /\bai\b/i.test(c.name ?? ''))) return true;
  return AI_WORDS.test(`${p.name ?? ''} ${p.tagline ?? ''} ${(p.description ?? '').slice(0, 300)}`);
}

const canonicalUrl = (p) => `https://www.producthunt.com/products/${encodeURIComponent(p.slug)}`;

/** One product reduced to what the page shows. */
export function shapeTool(p) {
  return {
    slug: p.slug,
    name: p.name,
    tagline: p.tagline ?? '',
    description: (p.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 280),
    url: canonicalUrl(p),
    thumbnail: p.thumbnail_url ?? null,
    votes: Number(p.votes_count) || 0,
    rating: p.reviews_rating ?? null,
    reviews: Number(p.reviews_count) || 0,
    launched: p.launched_at ?? null,
    category: p.categories?.[0]?.name ?? null,
    makers: (p.makers ?? []).map((m) => m.name).filter(Boolean).slice(0, 3),
    hasMcp: Boolean(p.mcp_server_urls?.length),
  };
}

/** Merge leaderboard results: one entry per product (most votes seen wins), AI tools only, most votes first. */
export function pickAiTools(lists, { count = 10 } = {}) {
  const best = new Map();
  for (const list of lists) {
    for (const p of list ?? []) {
      if (!p?.slug || !p.name || !isAiTool(p)) continue;
      const prev = best.get(p.slug);
      if (!prev || (Number(p.votes_count) || 0) > (Number(prev.votes_count) || 0)) best.set(p.slug, p);
    }
  }
  return [...best.values()]
    .map(shapeTool)
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name))
    .slice(0, count);
}

/** Pull the product list out of an MCP tool result (structured text part, or structuredContent). */
export function productsFromResult(result) {
  const candidates = [result?.structuredContent, ...(result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text)];
  for (const c of candidates) {
    try {
      const doc = typeof c === 'string' ? JSON.parse(c) : c;
      if (doc?.status === 'ok' && Array.isArray(doc.data?.products)) return doc.data.products;
    } catch {
      /* not the JSON part */
    }
  }
  return [];
}

/** Call one tool on the Product Hunt MCP server. `post(body)` returns the response text and content type. */
export async function callTool(post, name, args, id = 1) {
  const { body, contentType } = await post(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }));
  let text = body;
  if (/event-stream/.test(contentType ?? '')) {
    text = body
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .pop() ?? '';
  }
  const msg = JSON.parse(text);
  if (msg.error) throw new Error(msg.error.message ?? 'MCP error');
  return msg.result;
}

/** Fetch the leaderboards and return the document saved to src/data/producthunt.json. */
export async function fetchTools(post, { now = new Date(), count = 10 } = {}) {
  const periods = periodsFor(now);
  const lists = await Promise.all(
    periods.map(async (date, i) => {
      try {
        return productsFromResult(await callTool(post, 'get_leaderboard', { date, limit: 8 }, i + 1));
      } catch {
        return [];
      }
    }),
  );
  const tools = pickAiTools(lists, { count });
  return { updated: now.toISOString(), source: 'Product Hunt', source_url: 'https://www.producthunt.com/', periods, tools };
}
