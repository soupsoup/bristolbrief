# Bristol County news and data sources

Research notes behind `src/data/sources.json`. Every feed marked **live** was fetched on 2026-09-26 and returned a valid feed with recent items. `npm run ingest` re-checks all of them and writes the results to `src/data/feed-status.json`.

## How the wire works

1. `scripts/ingest.mjs` fetches each enabled source in `src/data/sources.json` (RSS, Atom or RDF).
2. `scripts/lib/parse.mjs` tags each item with the Bristol County towns it names (including villages such as Assonet, North Dartmouth and Ocean Grove) and guesses a section.
3. News items are kept only when the headline or summary names one of the 20 Bristol County municipalities or a village inside one, or names a region that includes the county. A story that names a county town is filed under that town. One that names no town but mentions Bristol County (not Bristol County, R.I.), the South Coast or southeastern Massachusetts is tagged **Region**: it appears in the headline list and under the Region filter, but on no town page. A regional story about a place just outside the county (Lakeville, Wareham, Tiverton and so on) is dropped, and so is a broader one ("southern New England", statewide) that names nothing in the county. Feed category labels such as "SE Mass" don't count. Single-town outlets (Dartmouth Week, Westport Shorelines, Fairhaven Neighborhood News) have `homeTown`: a story from one of them that names no county town is filed under that town, unless it names a place outside the county or looks like a classified ad, section page or print-edition listing. Town halls, police departments and agenda feeds have `defaultTowns`; all of their items are kept and filed under that town.
   Property listings (a title that is an address and town, "house for rent", "3 bed, 2 bath", an open house with an address, "just listed", "price reduced") go to the **Listings** section (`isPropertyListing` in `scripts/lib/parse.mjs`). Listings appear only on /section/listings/ and in a small box on their town's page, never in the news lists, the home page or All stories.
   **Sports.** High school games come from the county papers' sports coverage (Google News search `hs-sports`, which keeps only stories the section rules call sports) plus any local feed story about a game. School names count as towns: Durfee, Bishop Connolly and Diman (Fall River), Bishop Stang (Dartmouth), Bishop Feehan (Attleboro), Oliver Ames and Coyle & Cassidy (Easton), Joseph Case (Swansea), Bristol-Plymouth (Taunton), Bristol Aggie (Dighton). Boston pro teams (Patriots, Red Sox, Bruins, Celtics, Revolution) each have a Google News search with a `team`; those stories credit the publisher, stay only in the Sports section, and are kept five days. ESPN's API blocks automated requests, so there are no live scores yet.
4. Items merge into `src/data/wire.json`, deduplicated by link and headline and collected and shown for 45 days and archived for six months; Google News results are collected, shown and kept for 14 days (`WIRE_WINDOWS` in `scripts/lib/parse.mjs`). The admin can see the whole archive.
5. JSON APIs go to their own files: MBTA commuter rail alerts (`transit.json`), NOAA tides (`tides.json`) and CivicClerk meeting calendars (`calendar.json`). If an API is down, the last good file stays in place.
6. Active National Weather Service alerts for zones MAZ017 (Northern Bristol), MAZ020 (Southern Bristol), MAC005 (county), ANZ234 (Buzzards Bay) and ANZ236 (Narragansett Bay) go to `src/data/alerts.json`.
7. `scripts/police-log.mjs` builds `src/data/police-log.json` from police log PDFs (see "Police logs" below).
8. `.github/workflows/ingest.yml` runs this hourly and commits only when headlines or alerts change. Your host then rebuilds the site.

The site shows each item's headline and the publisher's own summary, and links to the original. It never republishes full articles.

## Live sources (49)

### Local news outlets

| Source | Feed | Notes |
|---|---|---|
| The New Bedford Light | `newbedfordlight.org/feed/` | Nonprofit, free |
| Fall River Reporter | `fallriverreporter.com/feed/` | Also posts statewide items; only those naming a county town are kept |
| New Bedford Guide | `newbedfordguide.com/feed` | |
| WBSM 1420 | `wbsm.com/category/news/feed/` | The `southcoast-news` category feed is empty; use the news feed; the town filter drops Plymouth County and statewide items |
| WSAR 1480 | `wsar.com/wsar-news/feed.xml` | Not WordPress; found by feed autodiscovery |
| Fairhaven Neighborhood News | `fairhavenneighborhoodnews.com/feed/` | |
| The Sun Chronicle | `thesunchronicle.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc` | BLOX CMS. Includes AP wire copy; the town filter keeps the local share. Paywalled. Section feeds returned 429 (rate limited) during testing |
| Portuguese Times | `portuguesetimes.com/feed/` | Portuguese-language; mostly international news, few local items |
| The Public's Radio | `thepublicsradio.org/feed/` | Now Ocean State Media. Returns 1,000 items and few mention the county |
| WPRI 12, SE Mass section | `wpri.com/news/local-news/se-mass/feed/` | Best regional TV source |
| Attleboro Patch, Mansfield Patch | `patch.com/feeds/aol/massachusetts/<slug>` | Mostly regional filler; the town filter drops most |
| CommonWealth Beacon, Rhode Island Current, Boston 25, WBZ, MassLive | Standard feeds | Statewide or regional; only stories naming a county town get through |

### Gannett papers (no RSS)

Gannett turned off RSS on its local sites in 2023. The wire uses Google News search feeds restricted to each site. These return a headline and link, with no summary.

| Paper | Query |
|---|---|
| The Standard-Times (New Bedford) | `site:southcoasttoday.com` |
| The Herald News (Fall River) | `site:heraldnews.com` |
| Taunton Daily Gazette | `site:tauntongazette.com` |
| The Enterprise (Easton, Raynham) | `site:enterprisenews.com (Easton OR Raynham)` |

Google News also stands in for three outlets with no feed: Dartmouth Week, Reporter Today (Seekonk, Rehoboth) and Westport Shorelines (eastbayri.com).

### Police, prosecutors and courts

| Source | Feed | Notes |
|---|---|---|
| Bristol County District Attorney | Google News search for "Bristol County District Attorney" | This environment's network policy blocks bristolda.com. The DA's site runs WordPress, so try `bristolda.com/category/press-releases/feed/` once that domain is allowed |
| U.S. Attorney, District of Massachusetts | `justice.gov/feeds/justice-news.xml?type[press_release]=press_release&component[1871]=1871` | justice.gov returns 401 intermittently; the ingest retries with a browser user agent |
| Attleboro, New Bedford, Swansea and Taunton police | WordPress `/feed/` on each department's site | Attleboro's newest post is from June |

### Police logs

The Public Safety page shows three police logs (and each town page shows its own), built by `scripts/police-log.mjs` (parsers in `scripts/lib/police.mjs`). Each hourly run reads the departments' log pages and processes only PDFs it hasn't seen, up to 20 per run.

| Department | Page | Format | Notes |
|---|---|---|---|
| New Bedford | `newbedfordpd.com/resources/police-logs/` | Daily "Arrest Status Report" PDF, posted a few days late | Scanned images since mid-August 2026, so they go through OCR (`pdftoppm` + `tesseract`). OCR reads cleanly at 300 dpi |
| Attleboro | `attleboropolice.org/logs-<year>/` | Weekly "Public Police Log" PDF with text (Microsoft Reporting Services), posted a few weeks late | Calls, then an arrest table with names, home addresses, age, race and sex. The parser takes only the charges and attaches them to the matching call; calls whose arrestee is under 18 (or has no readable age) are dropped. In two-digit months the year's last digit wraps to the next line; the parser rejoins it. The 2025 page's October to December files use the same format |
| Taunton | `tauntonpd.com/tpd-police-logs/` | One large ProPhoenix "Public Log" PDF with text, posted every few months | The current file covers Jan. 1 to July 6, 2026 (1,778 pages, about 14,000 calls). Times print on a 12-hour clock with no AM/PM; the parser infers it from the incident order. The file also contains an arrest table with names and home addresses, which the parser ignores |

What the site publishes: time, street name (no house number), charges or call type, and the outcome for Taunton calls. It leaves out names and home addresses, officers, juvenile arrests (and any New Bedford arrest whose juvenile flag OCR can't read), and medical, mental-health and routine calls (patrols, building checks, alarms, parking, fender-benders). Entries are kept six months. The CI job installs `poppler-utils` and `tesseract-ocr` only when a new PDF is waiting, and a failure there never blocks the headline update.

### Town and city halls

| Municipality | Platform | News feed | Agenda feed |
|---|---|---|---|
| Acushnet | CivicPlus | Empty (not used) | **Live** |
| Attleboro | CivicPlus | Empty (not used) | **Live** |
| Dartmouth | CivicPlus | **Live** | **Live** |
| Dighton | CivicPlus | **Live** | **Live** |
| Mansfield | CivicPlus | **Live** | **Live** |
| New Bedford | WordPress behind a Cloudflare bot challenge | Google News `site:newbedford-ma.gov` | Not available (HTML pages only) |
| North Attleborough | CivicPlus | **Live** | **Live** |
| Norton | CivicPlus | Empty (not used) | **Live** |
| Seekonk | CivicPlus | **Live** (intermittent timeouts) | **Live** |
| Somerset | CivicPlus | **Live** | **Live** |
| Taunton | CivicPlus + CivicClerk | **Live** | **Live** |
| Westport | Revize | **Live** at `/rss.xml`, but items have no dates | Not available |

CivicPlus feed URLs follow one pattern: `/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml` for news, `ModID=65&CID=All-0` for agendas, `ModID=63` for the Alert Center, `ModID=58` for the calendar and `ModID=76` for bids. Each site lists its feeds at `/rss.aspx`, with per-board agenda feeds such as `CID=Attleboro-Municipal-Council-5`.

## Found but not wired up yet

### Town sites that need a scraper or a different route

| Municipality | What exists | Why it isn't live |
|---|---|---|
| Fall River | Revize site with a news list (`fallriverma.gov/newslist.php`); City Council agendas on Revize pages; School Committee on BoardDocs; meeting video through the FRGTV Cablecast API | No RSS; needs an HTML scraper |
| Easton | Revize news list (`newslist.php`); agendas on Documents-On-Demand; ArcGIS Hub open data | No RSS; needs an HTML scraper |
| Swansea | Revize with per-board agenda pages | No RSS. The police feed is live |
| Freetown | CivicPlus | Feed URLs returned 404 or timed out; needs a retry from another network |
| Fairhaven, Raynham, Rehoboth, Berkley | WordPress (Fairhaven, Berkley) and Virtual Towns & Schools (Raynham, Rehoboth) | Cloudflare returns 403 to automated requests. Google News site searches could work as a fallback |
| Dartmouth Police | WordPress with monthly log PDFs | Cloudflare 403 |

Dartmouth also posts police log PDFs; they aren't parsed yet (its site returns a Cloudflare 403).

### Data APIs tested live

| Source | Endpoint | Status | Use |
|---|---|---|---|
| NWS alerts | `api.weather.gov/alerts/active?zone=MAZ017,MAZ020,MAC005,ANZ234,ANZ236` | **Wired up** | Alert banner and `/weather/` |
| MBTA alerts | `api-v3.mbta.com/alerts?filter[route]=CR-NewBedford,CR-Providence` | **Wired up** | `/transit/`, home page, and town pages with a station. Filtered to line-wide alerts and the eight Bristol County stations; browsers re-fetch live (the API allows cross-origin requests) |
| NOAA tides | `api.tidesandcurrents.noaa.gov/api/prod/datagetter` for New Bedford Harbor `8447636`, Fall River `8447386`, Round Hill Point `8447842`, Westport Harbor `8447975` | **Wired up** | `/weather/#tides`, home page, coastal town pages. The two harbor stations also report live water level |
| USGS river gauges | `waterservices.usgs.gov/nwis/iv/?sites=01108000,01109060` | 200 | Taunton River and Threemile River flood levels |
| Taunton CivicClerk | `tauntonma.api.civicclerk.com/v1/Events` | **Wired up** | Dated meetings on `/meetings/`, the home page and the Taunton page. Times are stored as local wall-clock time with a misleading `Z` suffix |

### Promising but untested here

- **MEMA power outage CSV** (`mema.mapsonline.net/power_outage_public.csv`): outages by town for every utility. The connection was reset from this environment.
- **MassDOT roadway events** (`massdot.state.ma.us/feeds/MARoadwayEventsXML.aspx`): timed out.
- **Division of Marine Fisheries shellfish closures**: an HTML list on mass.gov; needs a scraper.
- **masspublicnotices.org**: legal notices by town; an ASP.NET search form with no API.
- **mass.gov press releases**: no RSS; scrape `mass.gov/press-releases/recent` and filter by town name.
- **DESE / Education-to-Career Hub** (Socrata), **Census ACS**, **DLS Municipal Databank**: good for data stories, not for a live wire.
- **YouTube channels** for local access TV (Acushnet `UCQLn-V7X9rp0JdWXh445neQ`, Norton Media Center `UCSB7j1FrUhxf32qygjxIryA`, RAYCAM `UCwCbOVwMK3Olgi99RKp4GQA`). This environment's proxy blocks youtube.com; the feeds are `youtube.com/feeds/videos.xml?channel_id=<id>`.

### Outlets without a usable feed

- **Boston Globe**: no supported RSS.
- **ABC6**: abc6.com now redirects to coastalabc.com, which has no feed.
- **NBC 10 (turnto10.com)**: the RSS page lists no feed URLs.
- **The Anchor** (Diocese of Fall River): the feed works but hasn't updated since March 2026.
- **Ocean State Media**: `index.rss` returns zero items; the old thepublicsradio.org feed still works.
- **The Gannett weeklies** (Mansfield News, Easton Journal, Norton Mirror, Raynham Call) closed or merged in 2022.

## Usage terms

Show a headline, the publisher's own summary and a link, with attribution. Don't reproduce full text, especially from paywalled sites (Gannett papers, The Sun Chronicle). Rhode Island Current publishes under Creative Commons and allows republication with credit. The New Bedford Light has no stated republication policy, so ask before republishing its stories in full.
