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
  const hostNames = ["Stripe", "Anthropic", "OpenAI"];
  const result = searchEvents(catalog.events, {
    hosts_any: hostNames,
    include_closed: true,
    limit: 100,
  });

  // Ground truth computed independently from the raw catalog, so this test
  // stays valid across calendar syncs instead of pinning a data snapshot.
  const expectedCountFor = (name: string) =>
    catalog.events.filter((event) => event.host.toLocaleLowerCase().includes(name.toLocaleLowerCase())).length;
  const expectedUnion = catalog.events.filter((event) =>
    hostNames.some((name) => event.host.toLocaleLowerCase().includes(name.toLocaleLowerCase())),
  ).length;

  assert.equal(result.total_matches, expectedUnion);
  for (const name of hostNames) {
    assert.equal(
      result.events.filter((event) => event.matched_host_queries.includes(name)).length,
      expectedCountFor(name),
    );
  }
  assert.ok(result.events.every((event) => event.matched_host_queries.length > 0));

  // Title-only mentions (host doesn't actually include the name) must not match.
  const titleOnly = catalog.events.filter(
    (event) =>
      hostNames.some((name) => event.title.toLocaleLowerCase().includes(name.toLocaleLowerCase())) &&
      !hostNames.some((name) => event.host.toLocaleLowerCase().includes(name.toLocaleLowerCase())),
  );
  assert.ok(titleOnly.length > 0, "fixture should contain at least one title-only mention to exercise this case");
  for (const event of titleOnly) {
    const searchEvent = result.events.find((e) => e.event_url === event.event_url);
    assert.ok(!searchEvent, `title-only mention "${event.title}" should not appear in host results`);
  }
});

test("gets a stable event by id", () => {
  const result = searchEvents(catalog.events, { query: "Claude Founder House", limit: 1 });
  const event = getEvent(catalog.events, result.events[0].event_id);
  assert.equal(event?.title, "Claude Founder House");
  assert.equal(event?.event_id, result.events[0].event_id);
});

test("splits a comma-joined host string into a hosts array", () => {
  const result = searchEvents(catalog.events, { query: "Compliance at Fintech Speed", limit: 1 });
  const event = result.events[0];
  assert.equal(event.host, "Midlyr, Stripe");
  assert.deepEqual(event.hosts, ["Midlyr", "Stripe"]);
});

test("flags virtual events from their neighborhood", () => {
  const inPerson = searchEvents(catalog.events, { query: "Claude Founder House", limit: 1 }).events[0];
  assert.equal(inPerson.is_virtual, false);

  const virtual = searchEvents(catalog.events, { virtual_only: true, limit: 1 }).events[0];
  assert.ok(virtual);
  assert.equal(virtual.is_virtual, true);
  assert.match(virtual.neighborhood, /Virtual/i);
});

test("classifies fintech topic and happy-hour/workshop formats from title text", () => {
  const fintech = searchEvents(catalog.events, { query: "Compliance at Fintech Speed", limit: 1 }).events[0];
  assert.ok(fintech.matched_topics.includes("fintech"));

  const happyHour = searchEvents(catalog.events, { format: "happy-hour", limit: 100 }).events;
  assert.ok(happyHour.length > 0);
  assert.ok(happyHour.every((event) => event.matched_formats.includes("happy-hour")));
  assert.ok(happyHour.some((event) => /happy hour/i.test(event.title)));

  const workshop = searchEvents(catalog.events, { format: "workshop", limit: 100 }).events;
  assert.ok(workshop.length > 0);
  assert.ok(workshop.every((event) => event.matched_formats.includes("workshop")));
});

test("lists useful filter facets with counts", () => {
  const facets = listFacets(catalog.events);

  // Ground truth computed independently from the raw catalog, so this test
  // stays valid across calendar syncs instead of pinning a data snapshot.
  const expectedStripeHosts = catalog.events.flatMap((event) => event.host.split(",").map((host) => host.trim()))
    .filter((host) => host === "Stripe").length;

  assert.ok(facets.dates.some((item) => item.value === "2026-10-07" && item.count > 400));
  assert.ok(facets.hosts.some((item) => item.value === "Stripe" && item.count === expectedStripeHosts));
  assert.ok(facets.neighborhoods.length > 5);
  assert.ok(facets.topics.some((item) => item.value === "hardware" && item.count > 20));
  assert.ok(facets.formats.some((item) => item.value === "networking" && item.count > 0));
});
