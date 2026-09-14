import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;

const enrichmentById = JSON.parse(fs.readFileSync(path.join(OUT, 'enrichment-by-id.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync('/workspace/tech-week-sf/url-refresh/techlist.cleaned.new.json', 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(OUT, 'enrichment-summary.json'), 'utf8'));

function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function primaryHost(h) {
  return (h || '').split(',')[0].trim();
}
function identityKey(city, date_label, start_time_display, title, host, neighborhood) {
  return [city, date_label, start_time_display, title, host, neighborhood].map(norm).join('|');
}
function fuzzyKey(city, title, host, date_label) {
  return [city, title, host, date_label].map(norm).join('|');
}

// Build lookups: exact (full host), primary-host, fuzzy (city+title+primaryHost+date), title+date+time
const byExact = new Map();
const byPrimary = new Map();
const byFuzzyPrimary = new Map();
const byTitleDateTime = new Map();

for (const [id, rec] of Object.entries(enrichmentById)) {
  const exact = identityKey(rec.city, rec.date_label, rec.start_time_display, rec.title, rec.host, rec.neighborhood);
  const primary = identityKey(rec.city, rec.date_label, rec.start_time_display, rec.title, primaryHost(rec.host), rec.neighborhood);
  const fuzzy = fuzzyKey(rec.city, rec.title, primaryHost(rec.host), rec.date_label);
  const tdt = [rec.city, rec.date_label, rec.start_time_display, norm(rec.title)].join('|');

  if (!byExact.has(exact)) byExact.set(exact, []);
  byExact.get(exact).push({ id, rec });
  if (!byPrimary.has(primary)) byPrimary.set(primary, []);
  byPrimary.get(primary).push({ id, rec });
  if (!byFuzzyPrimary.has(fuzzy)) byFuzzyPrimary.set(fuzzy, []);
  byFuzzyPrimary.get(fuzzy).push({ id, rec });
  if (!byTitleDateTime.has(tdt)) byTitleDateTime.set(tdt, []);
  byTitleDateTime.get(tdt).push({ id, rec });
}

function unionTags(hits) {
  const topics = new Set();
  const types = new Set();
  for (const h of hits) {
    for (const t of h.rec.topics || []) topics.add(t);
    for (const t of h.rec.types || []) types.add(t);
  }
  return { topics: [...topics].sort(), types: [...types].sort() };
}

let matchedExact = 0;
let matchedPrimaryHost = 0;
let matchedFuzzy = 0;
let matchedTitleDateTime = 0;
let unmatched = 0;
let withTopic = 0;
let withType = 0;
let withEither = 0;
const unmatchedSamples = [];
const ambiguousSamples = [];
const matchMethods = { exact: 0, primary_host: 0, fuzzy: 0, title_date_time: 0, none: 0 };

const enrichedEvents = catalog.events.map((ev) => {
  const exactKey = identityKey(ev.city, ev.date_label, ev.start_time_display, ev.title, ev.host, ev.neighborhood);
  const primaryKey = identityKey(ev.city, ev.date_label, ev.start_time_display, ev.title, primaryHost(ev.host), ev.neighborhood);
  const fuzzy = fuzzyKey(ev.city, ev.title, primaryHost(ev.host), ev.date_label);
  const tdt = [ev.city, ev.date_label, ev.start_time_display, norm(ev.title)].join('|');

  let hits = byExact.get(exactKey) || [];
  let method = 'exact';
  if (!hits.length) {
    hits = byPrimary.get(primaryKey) || [];
    method = hits.length ? 'primary_host' : method;
  }
  if (!hits.length) {
    hits = byFuzzyPrimary.get(fuzzy) || [];
    method = hits.length ? 'fuzzy' : method;
  }
  if (!hits.length) {
    hits = byTitleDateTime.get(tdt) || [];
    method = hits.length ? 'title_date_time' : 'none';
  }

  let topics = [];
  let types = [];
  if (hits.length >= 1) {
    ({ topics, types } = unionTags(hits));
    if (method === 'exact') { matchedExact++; matchMethods.exact++; }
    else if (method === 'primary_host') { matchedPrimaryHost++; matchMethods.primary_host++; }
    else if (method === 'fuzzy') { matchedFuzzy++; matchMethods.fuzzy++; }
    else if (method === 'title_date_time') { matchedTitleDateTime++; matchMethods.title_date_time++; }
    if (hits.length > 1 && ambiguousSamples.length < 15) {
      ambiguousSamples.push({
        catalog: { city: ev.city, date_label: ev.date_label, start_time_display: ev.start_time_display, title: ev.title, host: ev.host, neighborhood: ev.neighborhood },
        hit_count: hits.length,
        method,
        ids: hits.map((h) => h.id),
      });
    }
  } else {
    unmatched++;
    matchMethods.none++;
    if (unmatchedSamples.length < 25) {
      unmatchedSamples.push({
        city: ev.city,
        date_label: ev.date_label,
        start_time_display: ev.start_time_display,
        title: ev.title,
        host: ev.host,
        neighborhood: ev.neighborhood,
        source_row: ev.source_row,
      });
    }
  }

  if (topics.length) withTopic++;
  if (types.length) withType++;
  if (topics.length || types.length) withEither++;

  return { ...ev, topics, types };
});

const matchRate = Math.round((withEither / catalog.events.length) * 10000) / 100;

const matchReport = {
  catalog_count: catalog.events.length,
  enrichment_api_ids: Object.keys(enrichmentById).length,
  matched_exact: matchedExact,
  matched_primary_host: matchedPrimaryHost,
  matched_fuzzy: matchedFuzzy,
  matched_title_date_time: matchedTitleDateTime,
  unmatched,
  with_ge1_topic: withTopic,
  with_ge1_type: withType,
  with_ge1_topic_or_type: withEither,
  match_rate_topic_or_type_pct: matchRate,
  match_methods: matchMethods,
  host_join_note:
    'Catalog host often lists cohosts comma-joined (from DOM); API company is owner-only. Matching uses exact identity first, then primary-host (first comma segment), then fuzzy city+title+primaryHost+date, then city+title+date+time.',
  unmatched_samples: unmatchedSamples,
  ambiguous_samples: ambiguousSamples,
};

const enrichedCatalog = {
  ...catalog,
  notes: [
    ...(catalog.notes || []),
    'topics[] and types[] are official Tech Week chip memberships from tRPC calendar.events filter enumeration (theme/format). Joined by identity (city+date_label+start_time_display+title+host+neighborhood); catalog multi-host strings match API owner via primary-host fallback.',
  ],
  event_count: enrichedEvents.length,
  events: enrichedEvents,
};

fs.writeFileSync(path.join(OUT, 'techlist.enriched.json'), JSON.stringify(enrichedCatalog, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'match-report.json'), JSON.stringify(matchReport, null, 2));

summary.match = {
  catalog_count: matchReport.catalog_count,
  with_ge1_topic: withTopic,
  with_ge1_type: withType,
  with_ge1_topic_or_type: withEither,
  unmatched,
  match_rate_topic_or_type_pct: matchRate,
  matched_exact: matchedExact,
  matched_primary_host: matchedPrimaryHost,
  matched_fuzzy: matchedFuzzy,
  matched_title_date_time: matchedTitleDateTime,
  host_join_note: matchReport.host_join_note,
};
summary.rematched_at = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'enrichment-summary.json'), JSON.stringify(summary, null, 2));

fs.appendFileSync(
  path.join(OUT, 'enrich-run.log'),
  `[${new Date().toISOString()}] Rematch complete: rate=${matchRate}% exact=${matchedExact} primary_host=${matchedPrimaryHost} fuzzy=${matchedFuzzy} tdt=${matchedTitleDateTime} unmatched=${unmatched}\n`
);

console.log(JSON.stringify({
  length: enrichedEvents.length,
  matchRate,
  matchedExact,
  matchedPrimaryHost,
  matchedFuzzy,
  matchedTitleDateTime,
  unmatched,
  withTopic,
  withType,
  withEither,
  unmatchedSamples,
}, null, 2));
