# The Bristol Brief

A local news site for the 20 cities and towns of Bristol County, Massachusetts, built with [Astro](https://astro.build). It is a fast static site: stories and events are Markdown files, and every page is prebuilt HTML.

## Run it

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/
npm run preview  # serve the built site
```

## What's included

- **Front page** with a lead story, secondary stories, a "The latest" rail, newsletter signup, section rows, upcoming events and a town directory.
- **Story pages** with byline, reading time, a sticky newsletter box and related stories (matched by town and section).
- **Section pages** (`/section/government/`, etc.) and **town pages** (`/towns/new-bedford/`, etc.) for all 20 municipalities.
- **Events calendar** (`/events/`) grouped by month.
- **About**, **Subscribe**, **Send a tip** and 404 pages.
- **RSS feed** at `/rss.xml`, Open Graph tags, light and dark themes, and mobile layouts.

## Local headline wire

The site also pulls real headlines from about 50 local sources: newsrooms, police departments, town and city halls, and meeting agenda feeds. It adds National Weather Service alerts for the county.

```sh
npm run ingest   # fetch all feeds, update src/data/*.json
npm test         # parser and town-matching tests
```

- Sources live in `src/data/sources.json`. To add a feed, add an entry with `id`, `name`, `url`, `category` (`news`, `public-safety`, `government` or `meetings`) and either `"filter": "county"` (keep only items naming a Bristol County place) or `"defaultTowns": ["slug"]`.
- `.github/workflows/ingest.yml` runs the ingest hourly and commits when headlines change, which triggers a redeploy on most hosts. Scheduled workflows only run on the default branch.
- Headlines appear on the home page, `/news/` (filter by town, type and source), each town page, `/meetings/`, `/weather/` and `/sources/`.
- `docs/sources.md` has the research notes: which feeds work, which need scrapers, and data APIs to add next.

## Publishing a story

Add a Markdown file to `src/content/stories/`. The filename becomes the URL (`/stories/<filename>/`).

```md
---
title: "Headline goes here"
dek: "One- or two-sentence summary shown under the headline."
date: 2026-10-01
author: Jane Reporter          # optional, defaults to "Bristol Brief Staff"
section: government            # news | government | schools | public-safety | real-estate | food-drink | business | things-to-do
towns: [fall-river, somerset]  # slugs from src/site.config.ts
image: /images/photo.jpg       # optional, put the file in public/images/
imageAlt: "Caption / alt text"
featured: true                 # optional, pins the story to the lead slot
draft: false                   # optional, true hides it
---

Story body in Markdown.
```

## Adding an event

Add a Markdown file to `src/content/events/`:

```md
---
title: "Harvest Festival"
date: 2026-10-03
time: "10 a.m.–4 p.m."
town: westport
venue: "Town common"
cost: "Free"
url: https://example.com   # optional
---
One-line description.
```

Past events drop off automatically at build time, so rebuild the site at least daily (a scheduled deploy hook on Netlify, Vercel or Cloudflare Pages works).

## Before launch

1. **Delete the sample content.** Every file in `src/content/` with `sample: true` is placeholder copy, not real reporting, and is labeled "Sample" on the site.
2. **Connect the newsletter.** Set `newsletterAction` in `src/site.config.ts` to your provider's form endpoint (beehiiv, Buttondown, Ghost, Mailchimp). Until then the form shows a "sign-ups open soon" message.
3. **Set the domain** in `astro.config.mjs` and the tip email and social links in `src/site.config.ts`.

## Where things live

| Path | Purpose |
| --- | --- |
| `src/site.config.ts` | Site name, sections, towns, newsletter endpoint, contact info |
| `src/content.config.ts` | Story and event schemas |
| `src/content/` | Stories and events (Markdown) |
| `src/pages/` | Routes |
| `src/components/` | Header, footer, story cards, signup, event list |
| `src/styles/global.css` | Colors, type and shared styles |
