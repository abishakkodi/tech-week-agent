import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog, searchEvents } from "../src/catalog.js";
import { fetchLiveEventDetails, parseLiveDetails } from "../src/live.js";

const event = searchEvents(loadCatalog().events, { query: "Claude Founder House", limit: 1 }).events[0];

const html = `<!doctype html><html><head>
<meta property="og:title" content="Fallback title">
<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"Event","name":"Claude Founder House",
  "startDate":"2026-10-06T08:00:00-07:00","endDate":"2026-10-06T10:00:00-07:00",
  "description":"A founder gathering.",
  "location":{"@type":"Place","name":"Demo Hall","address":{"streetAddress":"1 Market St","addressLocality":"San Francisco"}}
}</script></head><body><button>Join the waitlist</button></body></html>`;

test("extracts bounded live details from public event metadata", () => {
  const details = parseLiveDetails(event, "https://partiful.com/e/example", html, "2026-09-08T00:00:00.000Z");
  assert.equal(details.event_id, event.event_id);
  assert.equal(details.tech_week_url, event.event_url);
  assert.equal(details.final_url, "https://partiful.com/e/example");
  assert.equal(details.title, "Claude Founder House");
  assert.equal(details.ends_at, "2026-10-06T10:00:00-07:00");
  assert.equal(details.venue_name, "Demo Hall");
  assert.match(details.venue_address ?? "", /1 Market St/);
  assert.equal(details.observed_registration_signal, "waitlist");
  assert.equal(details.fetched_at, "2026-09-08T00:00:00.000Z");
});

test("follows a bounded public redirect without losing the Tech Week URL", async () => {
  const fetcher = async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url.includes("tech-week.com")) return new Response(null, { status: 302, headers: { location: "https://partiful.com/e/example" } });
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  };
  const details = await fetchLiveEventDetails(event, fetcher as typeof fetch);
  assert.equal(details.final_url, "https://partiful.com/e/example");
  assert.equal(details.tech_week_url, event.event_url);
});

test("refuses redirects to private network addresses", async () => {
  const fetcher = async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } });
  await assert.rejects(() => fetchLiveEventDetails(event, fetcher as typeof fetch), /private or local/);
});
