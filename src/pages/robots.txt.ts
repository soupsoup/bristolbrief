import type { APIRoute } from 'astro';

// Served from here (not public/) so the sitemap line carries the site's own address.
export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://bristolbrief.com');
  const body = `User-agent: *\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${new URL('/sitemap-index.xml', base).href}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
