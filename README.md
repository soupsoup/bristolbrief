# The Bristol Brief

One front page for the 20 cities and towns of Bristol County, Massachusetts. The site gathers headlines from local newsrooms, police departments and town halls, plus meeting agendas, weather alerts, tides and commuter rail alerts. Every headline links to the original story. It's built with [Astro](https://astro.build) as a static site.

## Run it

```sh
npm install
npm run ingest   # fetch feeds and APIs, update src/data/*.json
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/
npm test         # parser, town-matching and data tests
```

## Pages

- **Home:** top stories, an "Around the county" rail, section rows, commuter rail alerts, tides, town hall notices and public meetings.
- **`/news/`:** every headline, filterable by town (including Countywide), type and source.
- **`/section/<slug>/`** and **`/towns/<slug>/`** for all 8 sections and 20 municipalities.
- **`/meetings/`**, **`/weather/`** (alerts and tides), **`/transit/`**, **`/sources/`**, plus About, Subscribe and Send a tip.
- **`/rss.xml`:** the headline feed, linking to the original stories.

## How the headlines work

- Sources live in `src/data/sources.json`. To add a feed, add an entry with `id`, `name`, `url` and `category` (`news`, `public-safety`, `government` or `meetings`).
- Only items that name one of the county's 20 cities and towns (or a village in one, like Assonet or North Dartmouth) make it onto the site. "South Coast" alone doesn't count. Stories that mention Bristol County but no town are kept with a "Countywide" label: they show in the headline list (and the Countywide filter on `/news/`) but on no town page. The exception is a town hall, police department or agenda feed: give it `"defaultTowns": ["slug"]` and all of its items are kept and filed under that town.
- `.github/workflows/ingest.yml` runs the ingest hourly and commits when headlines change, which triggers a redeploy on most hosts. Scheduled workflows only run on the default branch.
- Headlines appear on the home page, `/news/` (filter by town, type and source), each town page, `/meetings/`, `/weather/` and `/sources/`.
- The same run pulls MBTA commuter rail alerts for Bristol County stations (`/transit/`, refreshed live in the browser), NOAA tide predictions for four harbors (`/weather/#tides`) and Taunton's CivicClerk meeting calendar (`/meetings/`). To add another CivicClerk town, add its tenant to `CIVICCLERK` in `scripts/ingest.mjs`.
- `docs/sources.md` has the research notes: which feeds work, which need scrapers, and data APIs to add next.

## Pinning the lead story

The home page picks its lead story automatically: the newest story with a real summary. To choose it yourself:

```sh
npm run pin -- "waterfront plan"              # pin the headline containing this text
npm run pin -- https://example.com/story      # or pin by URL
npm run pin -- "waterfront plan" --hours 48   # stay up 48 hours (default 24)
npm run pin -- "waterfront plan" --summary "Your own summary for the home page"
npm run pin                                   # show the current pin
npm run pin -- --clear                        # back to automatic
```

To pin a story the feeds haven't picked up, pin its URL with `--title "Headline" --source "Outlet"` (and optionally `--town <slug>`). The two stories under the lead are still picked automatically, from different outlets.

The pin lives in `src/data/pinned.json`, so you can also edit it on GitHub without the command line:

```json
{
  "lead": {
    "url": "https://newbedfordlight.org/some-story/",
    "until": "2026-09-28T18:00:00-04:00"
  }
}
```

Commit and push (or let the hourly job rebuild) to update the site. An expired pin is ignored, and the lead goes back to automatic on the next build.

## Before launch

1. **Connect the newsletter.** Set `newsletterAction` in `src/site.config.ts` to your provider's form endpoint (beehiiv, Buttondown, Ghost, Mailchimp). Until then the form shows a "sign-ups open soon" message.
2. **Set the domain** in `astro.config.mjs` and the contact email and social links in `src/site.config.ts`.
3. **Merge to the default branch** so the hourly GitHub Actions job can run.

## Where things live

| Path | Purpose |
| --- | --- |
| `src/site.config.ts` | Site name, sections, towns, newsletter endpoint, contact info |
| `src/data/sources.json` | Feed registry |
| `src/data/*.json` | Ingested headlines, alerts, transit, tides, meetings, feed status |
| `scripts/ingest.mjs`, `scripts/lib/` | Fetching, parsing, town tagging |
| `src/pages/` | Routes |
| `src/components/` | Header, footer, headline cards and lists, alerts, tides, meetings |
| `src/styles/global.css` | Colors, type and shared styles |
| `docs/sources.md` | Source research notes |
