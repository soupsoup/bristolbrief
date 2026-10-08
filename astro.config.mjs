// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';

// Canonical URLs, Open Graph tags and the RSS feed use this address.
// Set SITE_URL once you have a custom domain; until then Vercel's
// production URL is used when building there.
const site =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://bristolbrief.com');

// Public pages are prerendered to static HTML. Only the admin area and its
// API routes (which set `export const prerender = false`) run as functions.
// The sitemap lists the prerendered public pages; the admin area is left out.
export default defineConfig({
  site,
  output: 'static',
  adapter: vercel(),
  integrations: [sitemap({ filter: (page) => !new URL(page).pathname.startsWith('/admin/') })],
});
