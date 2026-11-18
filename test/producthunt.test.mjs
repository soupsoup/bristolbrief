import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, periodsFor, isAiTool, shapeTool, pickAiTools, productsFromResult, callTool, fetchTools } from '../scripts/lib/producthunt.mjs';

const product = (o) => ({
  slug: o.slug ?? o.name.toLowerCase(),
  name: o.name,
  tagline: o.tagline ?? '',
  description: o.description ?? '',
  votes_count: o.votes ?? 100,
  categories: o.categories ?? [],
  makers: o.makers ?? [{ name: 'A Maker' }],
  ...(o.mcp && { mcp_server_urls: ['https://x/mcp'] }),
});

test('isoWeek follows the Pacific-time date and ISO numbering', () => {
  assert.equal(isoWeek(new Date('2026-11-18T15:00:00Z')), '2026-W47');
  assert.equal(isoWeek(new Date('2026-11-09T09:00:00Z')), '2026-W46');
  // 2027-01-01 at 03:00 UTC is still Dec. 31 in Pacific time, ISO week 53 of 2026.
  assert.equal(isoWeek(new Date('2027-01-01T03:00:00Z')), '2026-W53');
});

test('periodsFor asks for yesterday, this week and last week', () => {
  assert.deepEqual(periodsFor(new Date('2026-11-18T15:00:00Z')), ['2026-11-17', '2026-W47', '2026-W46']);
});

test('isAiTool uses categories, then words in the name, tagline and description', () => {
  assert.equal(isAiTool(product({ name: 'Foo', categories: [{ name: 'AI sales tools', slug: 'ai-sales-tools' }] })), true);
  assert.equal(isAiTool(product({ name: 'Foo', tagline: 'An agent that books calls' })), true);
  assert.equal(isAiTool(product({ name: 'Foo', description: 'Uses GPT to draft replies.' })), true);
  assert.equal(isAiTool(product({ name: 'Foo', tagline: 'A paid-for note taking app', categories: [{ name: 'Notes', slug: 'notes' }] })), false);
  assert.equal(isAiTool(product({ name: 'Maintain', tagline: 'Keep your plants alive' })), false, 'a word that only contains "ai" does not count');
});

test('pickAiTools keeps AI products, one per slug with the most votes, sorted, limited', () => {
  const week = [product({ name: 'Alpha', tagline: 'AI writing', votes: 300 }), product({ name: 'Boring', tagline: 'A spreadsheet', votes: 900 })];
  const day = [product({ name: 'Alpha', tagline: 'AI writing', votes: 340 }), product({ name: 'Beta', tagline: 'LLM router', votes: 320 }), product({ name: 'Gamma', tagline: 'AI notes', votes: 10 })];
  const out = pickAiTools([week, day], { count: 2 });
  assert.deepEqual(out.map((t) => [t.name, t.votes]), [['Alpha', 340], ['Beta', 320]]);
});

test('shapeTool builds a canonical Product Hunt link without tracking parameters', () => {
  const t = shapeTool({ ...product({ name: 'Alpha', mcp: true }), url: 'https://www.producthunt.com/products/alpha?ref=mcp', reviews_rating: 4.5, reviews_count: 3 });
  assert.equal(t.url, 'https://www.producthunt.com/products/alpha');
  assert.equal(t.hasMcp, true);
  assert.equal(t.rating, 4.5);
});

test('productsFromResult reads the JSON part of a tool result and ignores the prose part', () => {
  const result = { content: [{ type: 'text', text: '#1 **Alpha**' }, { type: 'text', text: JSON.stringify({ status: 'ok', data: { products: [{ slug: 'a' }] } }) }] };
  assert.deepEqual(productsFromResult(result), [{ slug: 'a' }]);
  assert.deepEqual(productsFromResult({ content: [{ type: 'text', text: 'nope' }] }), []);
});

test('callTool handles plain JSON and event-stream responses and surfaces MCP errors', async () => {
  const ok = { jsonrpc: '2.0', id: 1, result: { content: [] } };
  assert.deepEqual(await callTool(async () => ({ body: JSON.stringify(ok), contentType: 'application/json' }), 't', {}), ok.result);
  assert.deepEqual(await callTool(async () => ({ body: `event: message\ndata: ${JSON.stringify(ok)}\n\n`, contentType: 'text/event-stream' }), 't', {}), ok.result);
  await assert.rejects(callTool(async () => ({ body: JSON.stringify({ error: { message: 'rate limited' } }), contentType: 'application/json' }), 't', {}), /rate limited/);
});

test('fetchTools survives one failing leaderboard and returns the others', async () => {
  const seen = [];
  const post = async (body) => {
    const { params } = JSON.parse(body);
    seen.push(params.arguments.date);
    if (params.arguments.date === '2026-11-17') throw new Error('boom');
    const products = [product({ name: `P-${params.arguments.date}`, tagline: 'AI thing', votes: 50 })];
    return { body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', data: { products } }) }] } }), contentType: 'application/json' };
  };
  const doc = await fetchTools(post, { now: new Date('2026-11-18T15:00:00Z') });
  assert.deepEqual(seen.sort(), ['2026-11-17', '2026-W46', '2026-W47']);
  assert.equal(doc.tools.length, 2);
  assert.equal(doc.source, 'Product Hunt');
});
