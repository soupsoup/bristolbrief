import type { APIRoute } from 'astro';
import { SECTIONS, TOWNS } from '../site.config';
import { localStories, loadData } from '../lib/wire';

export const prerender = false;

const STATIC_PAGES = [
  '', 'news', 'all-stories', 'election', 'meetings', 'weather', 'traffic', 'transit', 'videos', 'tools', 'social',
  'taunton-river', 'sources', 'about', 'tips', 'subscribe',
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Built on request (and cached by Vercel) so new manual stories appear without a deploy.
export const GET: APIRoute = async ({ site }) => {
  await loadData();
  const base = site ?? new URL('https://bristolbrief.com');
  const paths = [
    ...STATIC_PAGES.map((p) => (p ? `/${p}/` : '/')),
    ...TOWNS.map((t) => `/towns/${t.slug}/`),
    ...SECTIONS.map((s) => `/section/${s.slug}/`),
    ...localStories().filter((s) => s.slug).map((s) => `/stories/${s.slug}/`),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${esc(new URL(p, base).href)}</loc></url>`).join('\n') +
    `\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
