#!/usr/bin/env node
/**
 * Full Tech Week topic+type enrichment via tRPC calendar.events
 * (same-origin fetch inside Playwright after opening calendar once).
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const CATALOG_PATH = '/workspace/tech-week-sf/url-refresh/techlist.cleaned.new.json';
const META_PATH = path.join(OUT, 'probe-meta.json');
const LOG_PATH = path.join(OUT, 'enrich-run.log');

const PER_PAGE = 48;
const THROTTLE_MS = 350;
const CITIES = ['sf', 'la'];

const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
const THEME_SLUGS = meta.theme_slugs; // label -> slug
const FORMAT_SLUGS = meta.format_slugs;
const SLUG_TO_THEME = Object.fromEntries(Object.entries(THEME_SLUGS).map(([l, s]) => [s, l]));
const SLUG_TO_FORMAT = Object.fromEntries(Object.entries(FORMAT_SLUGS).map(([l, s]) => [s, l]));

const logLines = [];
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`;
  console.log(line);
  logLines.push(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatTime(t) {
  if (!t || typeof t !== 'string') return '';
  const [hh, mm] = t.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return t;
  const ampm = hh >= 12 ? 'pm' : 'am';
  let h = hh % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, '0')}${ampm}`;
}

function formatDate(d) {
  // API: "2026-10-05" -> catalog: "Monday, Oct 5"
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${dt.getDate()}`;
}

function absHref(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return `https://www.tech-week.com${href}`;
}

function norm(s) {
  return (s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function identityKey(city, date_label, start_time_display, title, host, neighborhood) {
  return [city, date_label, start_time_display, title, host, neighborhood].map(norm).join('|');
}

function fuzzyKey(city, title, host, date_label) {
  return [city, title, host, date_label].map(norm).join('|');
}

function makeBody(city, theme, format, cursor) {
  return {
    city,
    q: '',
    featured: false,
    day: 'all',
    track: [],
    sponsor: [],
    theme: theme ? [theme] : [],
    format: format ? [format] : [],
    location: [],
    time: [],
    host: [],
    sortBy: 'time',
    sortOrder: 'asc',
    cursor,
    direction: 'forward',
  };
}

async function fetchPage(page, body) {
  return page.evaluate(async (b) => {
    const res = await fetch('/api/trpc/calendar.events?batch=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ '0': b }),
    });
    const text = await res.text();
    return { status: res.status, text };
  }, body);
}

async function enumerateFilter(page, city, kind, slug, label) {
  const theme = kind === 'theme' ? slug : null;
  const format = kind === 'format' ? slug : null;
  const tag = kind === 'baseline' ? 'baseline' : `${kind}:${slug}`;
  const errors = [];
  const events = [];
  let total = null;
  let perPage = PER_PAGE;
  let pagesFetched = 0;

  // First page
  let cursor = 1;
  let first;
  try {
    first = await fetchPage(page, makeBody(city, theme, format, cursor));
  } catch (e) {
    errors.push({ cursor: 1, error: String(e) });
    // retry once
    await sleep(1000);
    try {
      first = await fetchPage(page, makeBody(city, theme, format, cursor));
    } catch (e2) {
      errors.push({ cursor: 1, error: `retry: ${e2}` });
      return { tag, kind, slug, label, city, total: 0, collected: 0, events: [], errors, pagesFetched: 0 };
    }
  }

  if (first.status !== 200) {
    errors.push({ cursor: 1, status: first.status, snippet: first.text.slice(0, 200) });
    await sleep(1500);
    try {
      first = await fetchPage(page, makeBody(city, theme, format, cursor));
    } catch (e) {
      errors.push({ cursor: 1, error: `retry: ${e}` });
      return { tag, kind, slug, label, city, total: 0, collected: 0, events: [], errors, pagesFetched: 0 };
    }
    if (first.status !== 200) {
      errors.push({ cursor: 1, status: first.status, snippet: first.text.slice(0, 200), after_retry: true });
      return { tag, kind, slug, label, city, total: 0, collected: 0, events: [], errors, pagesFetched: 0 };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(first.text);
  } catch (e) {
    errors.push({ cursor: 1, error: `json: ${e}`, snippet: first.text.slice(0, 200) });
    return { tag, kind, slug, label, city, total: 0, collected: 0, events: [], errors, pagesFetched: 0 };
  }

  const data = parsed?.[0]?.result?.data;
  if (!data) {
    errors.push({ cursor: 1, error: 'missing result.data', snippet: first.text.slice(0, 300) });
    return { tag, kind, slug, label, city, total: 0, collected: 0, events: [], errors, pagesFetched: 0 };
  }

  total = data.total;
  perPage = data.perPage || PER_PAGE;
  events.push(...(data.results || []));
  pagesFetched = 1;

  const lastCursor = Math.max(1, Math.ceil(total / perPage));
  log(`  [${city}] ${tag} total=${total} pages=${lastCursor}`);

  for (cursor = 2; cursor <= lastCursor; cursor++) {
    await sleep(THROTTLE_MS);
    let resp;
    try {
      resp = await fetchPage(page, makeBody(city, theme, format, cursor));
    } catch (e) {
      errors.push({ cursor, error: String(e) });
      await sleep(1000);
      try {
        resp = await fetchPage(page, makeBody(city, theme, format, cursor));
      } catch (e2) {
        errors.push({ cursor, error: `retry: ${e2}` });
        continue;
      }
    }
    if (resp.status !== 200) {
      errors.push({ cursor, status: resp.status, snippet: resp.text.slice(0, 150) });
      await sleep(1500);
      try {
        resp = await fetchPage(page, makeBody(city, theme, format, cursor));
      } catch (e) {
        errors.push({ cursor, error: `retry: ${e}` });
        continue;
      }
      if (resp.status !== 200) {
        errors.push({ cursor, status: resp.status, after_retry: true });
        continue;
      }
    }
    let p;
    try {
      p = JSON.parse(resp.text);
    } catch (e) {
      errors.push({ cursor, error: `json: ${e}` });
      continue;
    }
    const d = p?.[0]?.result?.data;
    if (!d) {
      errors.push({ cursor, error: 'missing result.data' });
      continue;
    }
    events.push(...(d.results || []));
    pagesFetched++;
    if (cursor % 5 === 0 || cursor === lastCursor) {
      log(`  [${city}] ${tag} page ${cursor}/${lastCursor} collected=${events.length}`);
    }
  }

  // Dedupe by id within this enumeration
  const byId = new Map();
  for (const e of events) {
    if (e?.id) byId.set(e.id, e);
  }

  if (byId.size !== total && errors.length === 0) {
    log(`  WARN [${city}] ${tag} collected unique=${byId.size} vs total=${total}`);
  }

  return {
    tag,
    kind,
    slug,
    label,
    city,
    total,
    collected: byId.size,
    events: [...byId.values()],
    errors,
    pagesFetched,
  };
}

function upsertEvent(acc, apiEv, city, topicLabel, typeLabel) {
  const id = apiEv.id;
  if (!id) return;
  let rec = acc.get(id);
  if (!rec) {
    rec = {
      city,
      topics: new Set(),
      types: new Set(),
      title: apiEv.name || '',
      host: apiEv.company || '',
      neighborhood: apiEv.location || '',
      date_raw: apiEv.date || '',
      time_raw: apiEv.time || '',
      date_label: formatDate(apiEv.date),
      start_time_display: formatTime(apiEv.time),
      event_url: absHref(apiEv.externalHref),
      isFeatured: !!apiEv.isFeatured,
      isInviteOnly: !!apiEv.isInviteOnly,
      registrationStatus: apiEv.registrationStatus || null,
      imageUrl: apiEv.imageUrl || null,
      facets: apiEv.facets || null,
      api_city: apiEv.city || null,
    };
    acc.set(id, rec);
  } else {
    // refresh identity / latest href
    if (apiEv.name) rec.title = apiEv.name;
    if (apiEv.company) rec.host = apiEv.company;
    if (apiEv.location) rec.neighborhood = apiEv.location;
    if (apiEv.date) {
      rec.date_raw = apiEv.date;
      rec.date_label = formatDate(apiEv.date);
    }
    if (apiEv.time) {
      rec.time_raw = apiEv.time;
      rec.start_time_display = formatTime(apiEv.time);
    }
    if (apiEv.externalHref) rec.event_url = absHref(apiEv.externalHref);
    if (apiEv.facets) rec.facets = apiEv.facets;
    if (apiEv.registrationStatus) rec.registrationStatus = apiEv.registrationStatus;
  }
  if (topicLabel) rec.topics.add(topicLabel);
  if (typeLabel) rec.types.add(typeLabel);
}

async function main() {
  // Fresh log
  fs.writeFileSync(LOG_PATH, '');
  log('Starting full enrichment scrape');
  log(`Themes: ${Object.keys(THEME_SLUGS).length}, Formats: ${Object.keys(FORMAT_SLUGS).length}`);

  const byId = new Map(); // api_id -> enrichment record (with Sets)
  const runStats = {
    started_at: new Date().toISOString(),
    cities: {},
    enumerations: [],
    errors: [],
  };

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(180000);

  // Open calendar once to establish cookies / pass bot check
  log('Opening SF calendar for session...');
  await page.goto('https://www.tech-week.com/calendar/sf', {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
  });
  await page.waitForTimeout(4000);
  try {
    const btn = page.locator('button:has-text("Accept"), button:has-text("Got it"), button:has-text("OK")').first();
    if (await btn.isVisible({ timeout: 1500 })) await btn.click({ timeout: 2000 });
  } catch {}

  for (const city of CITIES) {
    runStats.cities[city] = {
      baseline_total: null,
      theme_totals: {},
      format_totals: {},
      unique_events: 0,
      enumeration_errors: [],
    };

    // Re-navigate when switching city to keep context fresh
    if (city !== 'sf') {
      log(`Opening ${city} calendar...`);
      await page.goto(`https://www.tech-week.com/calendar/${city}`, {
        waitUntil: 'domcontentloaded',
        timeout: 180000,
      });
      await page.waitForTimeout(3000);
    }

    // 1) Baseline
    log(`[${city}] baseline (unfiltered)`);
    await sleep(THROTTLE_MS);
    const baseline = await enumerateFilter(page, city, 'baseline', null, null);
    runStats.cities[city].baseline_total = baseline.total;
    runStats.enumerations.push({
      city,
      kind: 'baseline',
      slug: null,
      total: baseline.total,
      collected: baseline.collected,
      pages: baseline.pagesFetched,
      errors: baseline.errors.length,
    });
    if (baseline.errors.length) {
      runStats.cities[city].enumeration_errors.push({ tag: baseline.tag, errors: baseline.errors });
      runStats.errors.push({ city, tag: baseline.tag, errors: baseline.errors });
    }
    for (const e of baseline.events) upsertEvent(byId, e, city, null, null);
    log(`[${city}] baseline done unique_so_far=${[...byId.values()].filter((r) => r.city === city).length}`);

    // 2) Themes
    for (const [label, slug] of Object.entries(THEME_SLUGS)) {
      log(`[${city}] theme=${slug} (${label})`);
      await sleep(THROTTLE_MS);
      const res = await enumerateFilter(page, city, 'theme', slug, label);
      runStats.cities[city].theme_totals[label] = res.total;
      runStats.enumerations.push({
        city,
        kind: 'theme',
        slug,
        label,
        total: res.total,
        collected: res.collected,
        pages: res.pagesFetched,
        errors: res.errors.length,
      });
      if (res.errors.length) {
        runStats.cities[city].enumeration_errors.push({ tag: res.tag, errors: res.errors });
        runStats.errors.push({ city, tag: res.tag, errors: res.errors });
      }
      for (const e of res.events) upsertEvent(byId, e, city, label, null);

      // Sanity checks
      if (city === 'sf' && slug === 'ai') {
        log(`  SANITY SF AI total=${res.total} (expect ~1158)`);
      }
    }

    // 3) Formats
    for (const [label, slug] of Object.entries(FORMAT_SLUGS)) {
      log(`[${city}] format=${slug} (${label})`);
      await sleep(THROTTLE_MS);
      const res = await enumerateFilter(page, city, 'format', slug, label);
      runStats.cities[city].format_totals[label] = res.total;
      runStats.enumerations.push({
        city,
        kind: 'format',
        slug,
        label,
        total: res.total,
        collected: res.collected,
        pages: res.pagesFetched,
        errors: res.errors.length,
      });
      if (res.errors.length) {
        runStats.cities[city].enumeration_errors.push({ tag: res.tag, errors: res.errors });
        runStats.errors.push({ city, tag: res.tag, errors: res.errors });
      }
      for (const e of res.events) upsertEvent(byId, e, city, null, label);

      if (city === 'sf' && slug === 'networking') {
        log(`  SANITY SF networking total=${res.total} (expect ~782)`);
      }
    }

    runStats.cities[city].unique_events = [...byId.values()].filter((r) => r.city === city).length;
    log(`[${city}] DONE unique_events=${runStats.cities[city].unique_events}`);
  }

  await browser.close();
  log('Browser closed. Building outputs...');

  // Serialize enrichment-by-id
  const enrichmentById = {};
  for (const [id, rec] of byId) {
    enrichmentById[id] = {
      city: rec.city,
      topics: [...rec.topics].sort(),
      types: [...rec.types].sort(),
      title: rec.title,
      host: rec.host,
      neighborhood: rec.neighborhood,
      date_raw: rec.date_raw,
      time_raw: rec.time_raw,
      date_label: rec.date_label,
      start_time_display: rec.start_time_display,
      event_url: rec.event_url,
      isFeatured: rec.isFeatured,
      isInviteOnly: rec.isInviteOnly,
      registrationStatus: rec.registrationStatus,
      api_city: rec.api_city,
    };
  }
  fs.writeFileSync(path.join(OUT, 'enrichment-by-id.json'), JSON.stringify(enrichmentById, null, 2));
  log(`Wrote enrichment-by-id.json (${Object.keys(enrichmentById).length} ids)`);

  // Coverage stats per city
  const coverage = {};
  for (const city of CITIES) {
    const recs = Object.values(enrichmentById).filter((r) => r.city === city);
    const withTopic = recs.filter((r) => r.topics.length > 0).length;
    const withType = recs.filter((r) => r.types.length > 0).length;
    const withEither = recs.filter((r) => r.topics.length > 0 || r.types.length > 0).length;
    const topicCounts = {};
    const typeCounts = {};
    for (const r of recs) {
      for (const t of r.topics) topicCounts[t] = (topicCounts[t] || 0) + 1;
      for (const t of r.types) typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    coverage[city] = {
      unique_api_events: recs.length,
      baseline_total: runStats.cities[city].baseline_total,
      with_ge1_topic: withTopic,
      with_ge1_type: withType,
      with_ge1_topic_or_type: withEither,
      topic_counts: topicCounts,
      type_counts: typeCounts,
      theme_api_totals: runStats.cities[city].theme_totals,
      format_api_totals: runStats.cities[city].format_totals,
    };
  }

  // --- Match to catalog ---
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const catalogEvents = catalog.events;
  log(`Catalog events: ${catalogEvents.length}`);

  // Build lookup maps from enrichment
  const byIdentity = new Map();
  const byFuzzy = new Map();
  for (const [id, rec] of Object.entries(enrichmentById)) {
    const ik = identityKey(rec.city, rec.date_label, rec.start_time_display, rec.title, rec.host, rec.neighborhood);
    if (!byIdentity.has(ik)) byIdentity.set(ik, []);
    byIdentity.get(ik).push({ id, rec });
    const fk = fuzzyKey(rec.city, rec.title, rec.host, rec.date_label);
    if (!byFuzzy.has(fk)) byFuzzy.set(fk, []);
    byFuzzy.get(fk).push({ id, rec });
  }

  let matchedExact = 0;
  let matchedFuzzy = 0;
  let unmatched = 0;
  let withTopic = 0;
  let withType = 0;
  let withEither = 0;
  const unmatchedSamples = [];
  const ambiguousSamples = [];
  const matchMethods = { exact: 0, fuzzy: 0, none: 0 };

  const enrichedEvents = catalogEvents.map((ev) => {
    const ik = identityKey(ev.city, ev.date_label, ev.start_time_display, ev.title, ev.host, ev.neighborhood);
    let hits = byIdentity.get(ik) || [];
    let method = 'exact';
    if (hits.length === 0) {
      const fk = fuzzyKey(ev.city, ev.title, ev.host, ev.date_label);
      hits = byFuzzy.get(fk) || [];
      method = hits.length ? 'fuzzy' : 'none';
    }

    let topics = [];
    let types = [];
    if (hits.length === 1) {
      topics = hits[0].rec.topics;
      types = hits[0].rec.types;
      if (method === 'exact') {
        matchedExact++;
        matchMethods.exact++;
      } else {
        matchedFuzzy++;
        matchMethods.fuzzy++;
      }
    } else if (hits.length > 1) {
      // Prefer the one with matching neighborhood + time if fuzzy; else union
      const preferred =
        hits.find(
          (h) =>
            norm(h.rec.neighborhood) === norm(ev.neighborhood) &&
            norm(h.rec.start_time_display) === norm(ev.start_time_display)
        ) || hits[0];
      // Union topics/types across ambiguous hits for safety
      const tset = new Set();
      const yset = new Set();
      for (const h of hits) {
        for (const t of h.rec.topics) tset.add(t);
        for (const t of h.rec.types) yset.add(t);
      }
      topics = [...tset].sort();
      types = [...yset].sort();
      if (method === 'exact') {
        matchedExact++;
        matchMethods.exact++;
      } else {
        matchedFuzzy++;
        matchMethods.fuzzy++;
      }
      if (ambiguousSamples.length < 15) {
        ambiguousSamples.push({
          catalog: {
            city: ev.city,
            date_label: ev.date_label,
            start_time_display: ev.start_time_display,
            title: ev.title,
            host: ev.host,
            neighborhood: ev.neighborhood,
          },
          hit_count: hits.length,
          method,
          preferred_id: preferred.id,
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

    return {
      ...ev,
      topics,
      types,
    };
  });

  const enrichedCatalog = {
    ...catalog,
    event_count: enrichedEvents.length,
    events: enrichedEvents,
    enrichment_notes: [
      ...(catalog.notes || []),
      'topics[] and types[] are official Tech Week chip memberships from tRPC calendar.events filter enumeration (theme/format), joined by identity.',
    ],
  };
  // Keep notes as original; don't mutate notes array oddly — put enrichment note separately
  delete enrichedCatalog.enrichment_notes;
  // Add a note to notes array copy
  enrichedCatalog.notes = [
    ...(catalog.notes || []),
    'topics[] and types[] are official Tech Week chip memberships from tRPC calendar.events filter enumeration (theme/format), joined by identity key (city+date_label+start_time_display+title+host+neighborhood) with fuzzy fallback (city+title+host+date).',
  ];

  fs.writeFileSync(path.join(OUT, 'techlist.enriched.json'), JSON.stringify(enrichedCatalog, null, 2) + '\n');
  log(`Wrote techlist.enriched.json length=${enrichedEvents.length}`);

  const matchRate = catalogEvents.length
    ? (withEither / catalogEvents.length) * 100
    : 0;

  const matchReport = {
    catalog_count: catalogEvents.length,
    enrichment_api_ids: Object.keys(enrichmentById).length,
    matched_exact: matchedExact,
    matched_fuzzy: matchedFuzzy,
    unmatched,
    with_ge1_topic: withTopic,
    with_ge1_type: withType,
    with_ge1_topic_or_type: withEither,
    match_rate_topic_or_type_pct: Math.round(matchRate * 100) / 100,
    match_methods: matchMethods,
    unmatched_samples: unmatchedSamples,
    ambiguous_samples: ambiguousSamples,
  };
  fs.writeFileSync(path.join(OUT, 'match-report.json'), JSON.stringify(matchReport, null, 2));
  log(`Match rate: ${matchReport.match_rate_topic_or_type_pct}% (${withEither}/${catalogEvents.length})`);

  // Date/time mapping documentation
  const sampleApi = Object.values(enrichmentById).slice(0, 5).map((r) => ({
    date_raw: r.date_raw,
    date_label: r.date_label,
    time_raw: r.time_raw,
    start_time_display: r.start_time_display,
    title: r.title,
  }));
  const sampleCat = catalogEvents.slice(0, 5).map((e) => ({
    date_label: e.date_label,
    start_time_display: e.start_time_display,
    title: e.title,
  }));

  runStats.finished_at = new Date().toISOString();
  const summary = {
    started_at: runStats.started_at,
    finished_at: runStats.finished_at,
    date_time_mapping: {
      description:
        'API date (YYYY-MM-DD) → catalog date_label via local noon parse: weekday full name + short month + day-of-month without leading zero (e.g. 2026-10-05 → "Monday, Oct 5"). API time (HH:MM 24h) → start_time_display: 12h clock without leading zero on hour + am/pm lowercase (e.g. 06:15 → "6:15am", 00:00 → "12:00am", 13:00 → "1:00pm").',
      api_fields: { date: 'YYYY-MM-DD', time: 'HH:MM' },
      catalog_fields: { date_label: 'Weekday, Mon D', start_time_display: 'H:MMam/pm' },
      sample_api_mapped: sampleApi,
      sample_catalog: sampleCat,
    },
    cities: coverage,
    enumerations: runStats.enumerations,
    enumeration_error_count: runStats.errors.length,
    errors: runStats.errors,
    match: {
      catalog_count: matchReport.catalog_count,
      with_ge1_topic: withTopic,
      with_ge1_type: withType,
      with_ge1_topic_or_type: withEither,
      unmatched: unmatched,
      match_rate_topic_or_type_pct: matchReport.match_rate_topic_or_type_pct,
      matched_exact: matchedExact,
      matched_fuzzy: matchedFuzzy,
    },
    sanity: {
      sf_ai_total: coverage.sf?.theme_api_totals?.['AI'] ?? null,
      sf_networking_total: coverage.sf?.format_api_totals?.['Networking'] ?? null,
      expect_sf_ai: 1158,
      expect_sf_networking: 782,
    },
    outputs: [
      'enrichment-by-id.json',
      'enrichment-summary.json',
      'techlist.enriched.json',
      'match-report.json',
      'enrich-run.log',
    ],
  };
  fs.writeFileSync(path.join(OUT, 'enrichment-summary.json'), JSON.stringify(summary, null, 2));
  log('Wrote enrichment-summary.json');
  log('ALL DONE');
  console.log(JSON.stringify({
    api_ids: Object.keys(enrichmentById).length,
    match_rate: matchReport.match_rate_topic_or_type_pct,
    sf_ai: summary.sanity.sf_ai_total,
    sf_net: summary.sanity.sf_networking_total,
    unmatched,
    errors: runStats.errors.length,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  try {
    fs.appendFileSync(LOG_PATH, `FATAL ${e.stack || e}\n`);
  } catch {}
  process.exit(1);
});
