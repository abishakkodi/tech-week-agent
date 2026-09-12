import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog, searchEvents } from "../src/catalog.js";

const catalog = loadCatalog();

test("defaults to SF when city is not provided", () => {
  const defResult = searchEvents(catalog.events, { limit: 50 });
  const sfResult = searchEvents(catalog.events, { city: "sf", limit: 50 });
  assert.equal(defResult.total_matches, sfResult.total_matches);
  assert.ok(defResult.events.every((e) => e.city === "sf"));
});

test("supports explicit LA and ALL city filters", () => {
  const la = searchEvents(catalog.events, { city: "la", include_closed: true, limit: catalog.events.length });
  assert.ok(la.events.every((e) => e.city === "la"));

  const sf = searchEvents(catalog.events, { city: "sf", include_closed: true, limit: catalog.events.length });
  const all = searchEvents(catalog.events, { city: "all", include_closed: true, limit: catalog.events.length });
  assert.ok(all.total_matches >= sf.total_matches);
  assert.ok(all.total_matches >= la.total_matches);
});

