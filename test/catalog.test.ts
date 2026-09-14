import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_TIMEZONE, getEvent, listFacets, loadCatalog, searchEvents, toSearchEvent, type Event } from "../src/catalog.js";

const catalog = loadCatalog();

function makeEvent(source_row: number, overrides: Partial<Event> = {}): Event {
  return {
    source_row, city: "sf", title: `Fixture ${source_row}`, host: "Fixture host",
    date_label: "Monday, Oct 5", start_time_display: "1:00pm", neighborhood: "SoMa",
    labels: [], event_url: `https://www.tech-week.com/go/event/fixture${source_row}`,
    ...overrides,
  };
}

test("validates every event in the synced catalog without pinning its contents", () => {
  assert.ok(catalog.events.length > 0);
  assert.ok(catalog.events.every((event) => event.city === "sf" || event.city === "la"));
  const all = searchEvents(catalog.events, { city: "all", include_closed: true, limit: catalog.events.length });
  assert.equal(all.total_matches, catalog.events.length);
  assert.equal(all.events.length, catalog.events.length);
  assert.equal(new Set(all.events.map((event) => event.event_id)).size, catalog.events.length);
});

test("searches topics, dates, times, and closed events", () => {
  const events = [
    makeEvent(1, { title: "Robotics hardware workshop", start_time_display: "1:30pm" }),
    makeEvent(2, { title: "Hardware breakfast", start_time_display: "8:00am" }),
    makeEvent(3, { title: "Hardware panel", labels: ["Closed"] }),
  ];
  const result = searchEvents(events, { topic: "hardware", dates: ["2026-10-05"], start_time_from: "12:00", start_time_to: "17:00", limit: 10 });
  assert.deepEqual(result.events.map((event) => event.source_row), [1]);
  assert.equal(result.events[0].starts_at, "2026-10-05T13:30:00-07:00");
  assert.equal(result.events[0].timezone, EVENT_TIMEZONE);
  assert.equal(result.events[0].end_time_known, false);
  assert.deepEqual(searchEvents(events, { topic: "hardware", include_closed: true, limit: 10 }).events.map((event) => event.source_row), [1, 2, 3]);
});

test("host filtering composes with city, closed status, and result limits", () => {
  const events = [
    makeEvent(1, { host: "Stripe" }), makeEvent(2, { city: "la", host: "Stripe" }),
    makeEvent(3, { city: "la", host: "Stripe", labels: ["Closed"] }),
    makeEvent(4, { title: "Stripe meetup", host: "Independent host" }), makeEvent(5, { host: "Stripe, OpenAI" }),
  ];
  const options = { hosts_any: ["stripe", "OpenAI"], limit: 100 };
  assert.deepEqual(searchEvents(events, options).events.map((event) => event.source_row).sort(), [1, 5]);
  assert.deepEqual(searchEvents(events, { ...options, city: "la" }).events.map((event) => event.source_row), [2]);
  const all = searchEvents(events, { ...options, city: "all", include_closed: true });
  assert.deepEqual(all.events.map((event) => event.source_row).sort(), [1, 2, 3, 5]);
  assert.deepEqual(all.events.find((event) => event.source_row === 5)?.matched_host_queries, ["stripe", "OpenAI"]);
  const limited = searchEvents(events, { ...options, city: "all", limit: 1 });
  assert.equal(limited.total_matches, 3);
  assert.equal(limited.events.length, 1);
  assert.equal(limited.truncated, true);
});

test("derives stable IDs, hosts, virtual status, topics, and formats from an event", () => {
  const event = makeEvent(1, { title: "Fintech happy hour workshop", host: "Midlyr, Stripe", neighborhood: "Virtual" });
  const enriched = toSearchEvent(event);
  assert.deepEqual(enriched.hosts, ["Midlyr", "Stripe"]);
  assert.equal(enriched.is_virtual, true);
  assert.ok(enriched.matched_topics.includes("fintech"));
  assert.ok(enriched.matched_formats.includes("happy-hour"));
  assert.ok(enriched.matched_formats.includes("workshop"));
  const rotated = { ...event, event_url: "https://www.tech-week.com/go/event/rotatedFixture1" };
  assert.equal(toSearchEvent(rotated).event_id, enriched.event_id);
  assert.equal(getEvent([event], enriched.event_id)?.event_id, enriched.event_id);
});

test("builds facets from the supplied events", () => {
  const facets = listFacets([
    makeEvent(1, { host: "Stripe, OpenAI", title: "Security panel" }),
    makeEvent(2, { host: "Stripe", title: "Networking mixer", neighborhood: "Mission" }),
  ]);
  assert.deepEqual(facets.hosts.find((item) => item.value === "Stripe"), { value: "Stripe", count: 2 });
  assert.deepEqual(facets.formats.find((item) => item.value === "panel"), { value: "panel", count: 1 });
  assert.deepEqual(facets.formats.find((item) => item.value === "networking"), { value: "networking", count: 1 });
  assert.deepEqual(facets.topics.find((item) => item.value === "security"), { value: "security", count: 1 });
});
