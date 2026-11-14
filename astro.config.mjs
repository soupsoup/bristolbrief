// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Canonical URLs, Open Graph tags and the RSS feed use this address.
// Set SITE_URL once you have a custom domain; until then Vercel's
// production URL is used when building there.
const site =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://bristolbrief.com');

// Every page renders on demand from the data branch (see src/lib/data-source.ts),
// so the hourly data commits never trigger a build. Vercel caches each rendered
// public page for an hour (ISR) and re-renders it on the next visit after that.
// The admin area and API routes are never cached. The sitemap is built in
// src/pages/sitemap.xml.ts.
export default defineConfig({
  site,
  output: 'server',
  adapter: vercel({ isr: { expiration: 3600, exclude: [/^\/admin/, /^\/api/] } }),
});
