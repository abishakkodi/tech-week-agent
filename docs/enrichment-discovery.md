# Tech Week calendar filter discovery (SF / LA)

**Date:** 2026-09-14  
**Stack:** Playwright Chromium headless (`channel: 'chrome'`), same as `url-refresh/scrape-both.mjs`  
**Pages:** `https://www.tech-week.com/calendar/sf`, `https://www.tech-week.com/calendar/la`

## Mechanism (how Topic / Type chips work)

1. **UI chips are toggle buttons** (`button[type=button]` badge-style) in the left filter rail.  
   - Topic chips → update the URL query param **`theme`**  
   - Type chips → update the URL query param **`format`**  
   - Both can combine: `?theme=ai&format=networking`  
   - Pressed state: `aria-pressed="true"` on the chip; “Clear all filters” resets.

2. **URL is the source of truth** (no filter state in `localStorage` / `sessionStorage`).  
   - Before click: `https://www.tech-week.com/calendar/sf`  
   - After Topic=AI: `https://www.tech-week.com/calendar/sf?theme=ai`  
   - After Type=Networking: `https://www.tech-week.com/calendar/sf?format=networking`  
   - **Direct navigation to these URLs works** (chip shows pressed; list is filtered). No UI click required.

3. **Network:** filtering is **server-side** via tRPC:
   - `POST https://www.tech-week.com/api/trpc/calendar.events?batch=1`
   - Body example:
     ```json
     {"0":{"city":"sf","q":"","featured":false,"day":"all","track":[],"sponsor":[],"theme":["ai"],"format":[],"location":[],"time":[],"host":[],"sortBy":"time","sortOrder":"asc","cursor":1,"direction":"forward"}}
     ```
   - Response includes `total`, `page`, `perPage` (**48**), and `results[]`.
   - GET variant also works: `?batch=1&input=<urlencoded JSON>`.
   - Bare datacenter `curl` hit **Vercel Security Checkpoint (429)**; **same-origin `fetch` inside Playwright** succeeds.

4. **Unrelated noise:** Next.js RSC prefetches under `/calendar/sf/tracks/...` and marketing track links (e.g. `/deep-tech`) — these are not the Topic chip filters.

## Do official topic/type tags appear on event rows?

**No.**

| Surface | What’s present | Topic/Type? |
|--------|----------------|-------------|
| DOM row badges (`[data-slot=badge]`) | `Featured`, `Closed` only | No |
| Link `data-*` | `data-ga-event-id`, `data-ga-event-title`, `data-ga-track` | No |
| tRPC list `results[].facets` | `time`, `locations`, `hosts` | No |

Official tags are **implicit by filter membership**: an event is “AI” iff it appears in the `theme:["ai"]` result set (events can belong to multiple themes/formats).

Also: `externalHref` /go/event/… tokens **rotate across requests**. Prefer stable **`id` (UUID)** for joins.

## Slug maps (UI label → query value)

### Topics → `?theme=`

| UI Topic | slug |
|----------|------|
| AI | `ai` |
| AR / VR | `ar-vr` |
| B2B | `b2b` |
| B2C / Consumer | `b2c-consumer` |
| Climate | `climate` |
| Creators | `creators` |
| Crypto / Web3 | `crypto-web3` |
| Cybersecurity | `cybersecurity` |
| Deep Tech | `deep-tech` |
| Defense | `defense` |
| Engineering | `engineering` |
| Fintech | `fintech` |
| Fundraising / Investing | `fundraising-investing` |
| Gaming | `gaming` |
| GTM | `gtm` |
| Hardware | `hardware` |
| Healthcare / Healthtech | `healthcare-healthtech` |
| HR / Hiring | `hr-hiring` |
| Infrastructure | `infrastructure` |
| International / Expansion | `international-expansion` |
| Media / Entertainment | `media-entertainment` |
| SaaS | `saas` |
| Women-focused | `women-focused` |

Slug rule: lowercase; `/` and spaces → `-`; collapse punctuation.

### Types → `?format=`

| UI Type | slug |
|---------|------|
| Breakfast, Brunch or Lunch | `breakfast-brunch-or-lunch` |
| Dinner | `dinner` |
| Experiential | `experiential` |
| Hackathon | `hackathon` |
| Happy Hour | `happy-hour` |
| Matchmaking | `matchmaking` |
| Networking | `networking` |
| Panel / Fireside Chat | `panel-fireside-chat` |
| Pitch Event / Demo Day | `pitch-event-demo-day` |
| Roundtable / Workshop | `roundtable-workshop` |

## Sample counts (API totals)

| Query | total |
|-------|------:|
| SF unfiltered | 1641 |
| SF `theme=ai` | **1158** |
| SF `format=networking` | **782** |
| SF `theme=ai&format=networking` | 564 |
| LA `theme=ai` | 427 |

DOM scroll title-node counts can **overshoot** API totals (virtualization); trust `total` from tRPC and dedupe by `id`.

## LA calendar

Same chip set and same `?theme=` / `?format=` + tRPC `city:"la"` mechanism. Confirmed `https://www.tech-week.com/calendar/la?theme=ai` presses AI and filters.

## Recommended scrape plan (enrichment — not run yet)

**Preferred (repeatable, no chip clicks):**

1. Launch Playwright Chromium (`channel: 'chrome'`), open any calendar page once (establish cookies / pass bot check).
2. For each city ∈ `{sf, la}` and each theme slug (23) and each format slug (10):
   - `page.evaluate` → `fetch('/api/trpc/calendar.events?batch=1', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ '0': { city, theme: [slug] or [], format: [slug] or [], …, cursor } }) })`
   - Paginate `cursor = 1 .. ceil(total/48)`.
   - Collect `{ id, name, date, time, company, location, externalHref }` (+ attach `topics: ['AI']` or `types: ['Networking']` for that run).
3. Merge: for each event `id`, union all themes/formats observed across runs.
4. Join onto the existing master scrape by `id` (from `data-ga-event-id`) or by identity tuple if needed.

**Fallback:** `goto calendar/{city}?theme={slug}` → scroll → DOM extract (same as `scrape-both.mjs`). Works but slower; URL alone is enough (no chip click).

**Avoid:** title-keyword guessing; Firecrawl interact; bare curl without browser context.

**Scale:** 23×2 + 10×2 = **66** filtered enumerations (+ optional unfiltered baseline). At ~25 pages × 48 for large themes, throttle politely between calls.

## Artifacts

| File | Contents |
|------|----------|
| `discovery.md` | This document |
| `probe-meta.json` | Counts, hrefs, slug maps, API notes, strategy |
| `probe-ai-sf.json` | Sample identities for Topic=AI (API-backed; total 1158) |
| `slug-map.json` | Raw click→URL mapping run |
| `api-findings.json` | Schema / totals from page-context tRPC |
| `probe-ai-sf-api.json` | Intermediate API sample |
