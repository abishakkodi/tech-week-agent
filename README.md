# SF Tech Week MCP

An open-source, read-only MCP server for searching a San Francisco Tech Week
calendar snapshot. It runs on Cloudflare Workers and returns the Tech Week URLs
already present in the source HTML.

## Tools

- Discovery: `search_events`, `find_events_by_hosts`, `list_facets`, `get_event`
- Live research: `get_live_event_details` for one selected event
- Evaluation: `compare_events`, `find_similar_events`, `find_alternatives`
- Planning: `summarize_day`, `find_networking_targets`, `build_itinerary`, `create_ics`

All tools are read-only. The live-research tool makes a bounded request to a
public event page; the remaining tools use the bundled snapshot. `create_ics` returns
a draft and never writes to a calendar. `build_itinerary` accepts free-time
windows, keeping calendar credentials and private event contents outside this
public server.

`get_live_event_details` may report an `observed_registration_signal` inferred
from public page text. It cannot report attendee count, capacity, acceptance
likelihood, or whether the user has already RSVPed.

- `search_events` searches title, host, neighborhood, and labels; supports a
  curated `hardware` topic; and filters by exact dates, start-time ranges,
  neighborhoods, and closed status.
- `hosts_any` matches any requested company against host attribution only, so
  title-only mentions do not become false host matches.
- Results include the exact Tech Week `event_url`, an RFC 3339 `starts_at`
  timestamp, `America/Los_Angeles`, and whether the catalog knows the end time.

This MCP does not read private calendars. A calling agent can safely combine
its results with any separately installed calendar MCP or plugin.

For “Are there events hosted by Stripe, Anthropic, or OpenAI?”, an agent can
make one call:

```json
{
  "hosts_any": ["Stripe", "Anthropic", "OpenAI"],
  "limit": 100
}
```

Each event reports `matched_host_queries`, letting the agent explain which
requested company matched. Requested companies with no returned match can be
reported as having no hosted events in the snapshot.

## Agent workflows

For “Help me find and plan hardware-focused events for the week,” an agent can
call `search_events` with:

```json
{
  "topic": "hardware",
  "dates": [
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
    "2026-10-11"
  ],
  "limit": 100
}
```

For “Which events am I free to attend Wednesday afternoon?”, it can call:

```json
{
  "dates": ["2026-10-07"],
  "start_time_from": "12:00",
  "start_time_to": "17:00",
  "limit": 100
}
```

It can then compare each returned `starts_at` value with the user's calendar
through the available calendar MCP or plugin. The snapshot does not contain
event end times or travel durations, so the agent should describe availability
as tentative unless it obtains those details elsewhere.

The calendar data is a snapshot, so dates and event listings are not live.
Opening an `event_url` lets Tech Week handle its own redirect to the RSVP
destination while retaining the original event attribution.

Event metadata is third-party content. The MCP labels it as untrusted data and
validates that every returned link is an HTTPS `www.tech-week.com/go/event/...`
URL.

The snapshot is for SF Tech Week 2026. Calendar timestamps use
`America/Los_Angeles` and the applicable October UTC offset.

## Requirements

- Node.js 22 or newer
- A Cloudflare account only when deploying

## Run locally

```sh
npm install
npm run start
```

Wrangler prints the local origin. Connect an MCP inspector or client to its
`/mcp` endpoint; the default is `http://localhost:8787/mcp`.

The health endpoint is available at `/health`.

## Validate

```sh
npm run check
```

This type-checks the Worker, runs the catalog tests, and creates a dry-run
Cloudflare deployment bundle.

## Deploy to Cloudflare Workers

Authenticate Wrangler, then deploy:

```sh
npx wrangler login
npm run deploy
```

The production MCP URL will be the deployed Worker URL followed by `/mcp`.

## Refresh the snapshot

Replace `techlist.md` with a newly captured calendar HTML snapshot, then run:

```sh
python3 scripts/clean_events.py
npm run check
```

Review the generated diff before committing it. The extractor rejects event
links outside the expected Tech Week URL shape.

## Project policy

Code is available under the MIT License. The bundled Tech Week snapshot and
derived event data are third-party material and are excluded from that license;
see [NOTICE](NOTICE). Contributions are described in
[CONTRIBUTING.md](CONTRIBUTING.md), and security reports are covered by
[SECURITY.md](SECURITY.md).
