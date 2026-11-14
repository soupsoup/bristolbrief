import type { APIRoute } from 'astro';

export const prerender = false;

// Older address from when the sitemap was generated at build time.
export const GET: APIRoute = ({ redirect }) => redirect('/sitemap.xml', 301);
