// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';

// DEPLOY_TARGET=node builds a standalone Node server for the VPS
// (deploy/vps/). Anything else, including Vercel's own builds, keeps the
// Vercel adapter, so both hosts work during the move.
const onVps = process.env.DEPLOY_TARGET === 'node';

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
  adapter: onVps ? node({ mode: 'standalone' }) : vercel(),
  // Behind nginx, Astro trusts X-Forwarded-For (the visitor's real IP, which
  // the newsletter rate limit needs) only for requests to these hosts.
  ...(onVps && {
    security: { allowedDomains: [{ hostname: 'bristolbrief.com' }, { hostname: 'www.bristolbrief.com' }] },
  }),
  integrations: [sitemap({ filter: (page) => !['/admin/', '/election/'].some((p) => new URL(page).pathname.startsWith(p)) })],
});
