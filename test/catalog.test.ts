import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_TIMEZONE, getEvent, listFacets, loadCatalog, searchEvents } from "../src/catalog.js";

const catalog = loadCatalog();

test("searches scraped events and preserves the Tech Week attribution URL", () => {
  const result = searchEvents(catalog.events, { query: "AGI wearables", limit: 10 });
  assert.equal(result.total_matches, 1);
  assert.equal(result.events[0].title, "AGI, Inc. Store - Wearables Pop-up");
  assert.match(result.events[0].event_url, /^https:\/\/www\.tech-week\.com\/go\/event\//);
});

test("finds hardware-focused events using related terminology", () => {
  const result = searchEvents(catalog.events, { topic: "hardware", limit: 100 });
  assert.ok(result.total_matches > 20);
  assert.ok(result.events.some((event) => event.title.includes("Hardware")));
  assert.ok(result.events.some((event) => event.title.includes("Robotics")));
  assert.ok(result.events.every((event) => event.matched_topics.includes("hardware")));
});

test("returns Wednesday afternoon events with calendar-compatible timestamps", () => {
  const result = searchEvents(catalog.events, { dates: ["2026-10-07"], start_time_from: "12:00", start_time_to: "17:00", limit: 100 });
  assert.ok(result.total_matches > 0);
  assert.ok(result.events.every((event) => event.local_date === "2026-10-07"));
  assert.ok(result.events.every((event) => event.start_time_24h >= "12:00" && event.start_time_24h <= "17:00"));
  assert.ok(result.events.every((event) => event.starts_at.endsWith("-07:00")));
  assert.ok(result.events.every((event) => event.timezone === EVENT_TIMEZONE && !event.end_time_known));
});

test("excludes closed events by default", () => {
  const open = searchEvents(catalog.events, { limit: 100 });
  const all = searchEvents(catalog.events, { include_closed: true, limit: 100 });
  assert.ok(open.events.every((event) => !event.labels.includes("Closed")));
  assert.ok(all.total_matches > open.total_matches);
});

test("matches any requested host without matching title-only mentions", () => {
  const result = searchEvents(catalog.events, {
    hosts_any: ["Stripe", "Anthropic", "OpenAI"],
    include_closed: true,
    limit: 100,
  });

  assert.equal(result.total_matches, 11);
  assert.equal(result.events.filter((event) => event.matched_host_queries.includes("Stripe")).length, 10);
  assert.equal(result.events.filter((event) => event.matched_host_queries.includes("Anthropic")).length, 1);
  assert.equal(result.events.filter((event) => event.matched_host_queries.includes("OpenAI")).length, 0);
  assert.ok(result.events.every((event) => event.matched_host_queries.length > 0));
});

test("gets a stable event by id", () => {
  const result = searchEvents(catalog.events, { query: "Claude Founder House", limit: 1 });
  const event = getEvent(catalog.events, result.events[0].event_id);
  assert.equal(event?.title, "Claude Founder House");
  assert.equal(event?.event_id, result.events[0].event_id);
});

test("lists useful filter facets with counts", () => {
  const facets = listFacets(catalog.events);
  assert.ok(facets.dates.some((item) => item.value === "2026-10-07" && item.count > 400));
  assert.ok(facets.hosts.some((item) => item.value === "Stripe" && item.count === 10));
  assert.ok(facets.neighborhoods.length > 5);
  assert.ok(facets.topics.some((item) => item.value === "hardware" && item.count > 20));
});
