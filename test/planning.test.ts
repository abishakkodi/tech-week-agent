import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog, searchEvents, toSearchEvent } from "../src/catalog.js";
import { alternativeEvents, buildItinerary, createIcs, networkingMatches, similarEvents } from "../src/planning.js";

const events = loadCatalog().events.map((event) => toSearchEvent(event));
const hardware = searchEvents(loadCatalog().events, { topic: "Hardware", include_closed: false, limit: 100 }).events;

test("ranks similar events with explainable reasons", () => {
  const matches = similarEvents(events, hardware[0].event_id, 5);
  assert.ok(matches.length > 0);
  assert.ok(matches.every((match) => match.score > 0 && match.reasons.length > 0));
});

test("finds only nearby same-day alternatives", () => {
  const source = hardware.find((event) => events.some((other) => other.local_date === event.local_date && other.event_id !== event.event_id))!;
  const matches = alternativeEvents(events, source.event_id, 10, 180);
  assert.ok(matches.every((match) => match.event.local_date === source.local_date));
  assert.ok(matches.every((match) => Math.abs(Date.parse(match.event.starts_at) - Date.parse(source.starts_at)) <= 180 * 60_000));
});

test("builds an itinerary only inside supplied free windows", () => {
  const candidates = searchEvents(loadCatalog().events, { dates: ["2026-10-07"], start_time_from: "12:00", start_time_to: "17:00", limit: 20 }).events;
  const result = buildItinerary(candidates, [{ starts_at: "2026-10-07T12:00:00-07:00", ends_at: "2026-10-07T17:00:00-07:00" }], 60, 30, 3);
  assert.ok(result.selected.length > 0 && result.selected.length <= 3);
  assert.ok(result.selected.every((event) => event.starts_at >= "2026-10-07T12:00:00-07:00"));
  assert.match(result.assumptions.join(" "), /travel/i);
});

test("creates a non-mutating ICS draft with Tech Week attribution URLs", () => {
  const ics = createIcs(hardware.slice(0, 2), 90);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.match(ics, /URL:https:\/\/www\.tech-week\.com\/go\/event\//);
  assert.match(ics, /DTEND:/);
});

test("separates host matches from title mentions", () => {
  const matches = networkingMatches(events, ["Stripe", "OpenAI"], 100);
  assert.ok(matches.some((match) => match.host_matches.includes("Stripe")));
  assert.ok(matches.every((match) => !match.title_mentions.some((name) => match.host_matches.includes(name))));
});
