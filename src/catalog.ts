import catalogJson from "../techlist.cleaned.json";

export const EVENT_YEAR = 2026;
export const EVENT_TIMEZONE = "America/Los_Angeles";
export const TOPICS = ["hardware"] as const;
export type Topic = (typeof TOPICS)[number];

export type Event = {
  date_label: string;
  start_time_display: string;
  title: string;
  host: string;
  neighborhood: string;
  labels: string[];
  event_url: string;
  source_row: number;
};

export type SearchOptions = {
  query?: string;
  topic?: Topic;
  dates?: string[];
  start_time_from?: string;
  start_time_to?: string;
  neighborhoods?: string[];
  hosts_any?: string[];
  include_closed?: boolean;
  limit: number;
};

export type SearchEvent = Event & {
  event_id: string;
  local_date: string;
  start_time_24h: string;
  starts_at: string;
  timezone: typeof EVENT_TIMEZONE;
  end_time_known: false;
  matched_topics: Topic[];
  matched_host_queries: string[];
};

export type SearchResult = { events: SearchEvent[]; total_matches: number; truncated: boolean };
type Catalog = { notes: string[]; events: Event[] };
export type FacetValue = { value: string; count: number };

const TECH_WEEK_EVENT_PATH = /^\/go\/event\/[A-Za-z0-9_-]+$/;
const DATE_LABEL = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Z][a-z]{2}) (\d{1,2})$/;
const DISPLAY_TIME = /^(\d{1,2}):(\d{2})(am|pm)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};
const TOPIC_PATTERNS: Record<Topic, RegExp> = {
  hardware: /\b(?:hardware|robot(?:s|ics)?|physical ai|manufactur\w*|semiconductor\w*|chips?|electronics?|devices?|wearables?|aerospace|defen[cs]e tech|drones?|autonomous vehicles?|mobility|industrial automation)\b/i,
};

function isTechWeekEventUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.tech-week.com" && url.port === ""
      && url.search === "" && url.hash === "" && TECH_WEEK_EVENT_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

function calendarFields(event: Event): Pick<SearchEvent, "local_date" | "start_time_24h" | "starts_at"> {
  const date = DATE_LABEL.exec(event.date_label);
  const time = DISPLAY_TIME.exec(event.start_time_display);
  if (!date || !time || !MONTHS[date[2]]) throw new Error(`Invalid calendar fields at source row ${event.source_row}.`);

  let hour = Number(time[1]) % 12;
  if (time[3] === "pm") hour += 12;
  const localDate = `${EVENT_YEAR}-${String(MONTHS[date[2]]).padStart(2, "0")}-${date[3].padStart(2, "0")}`;
  const startTime = `${String(hour).padStart(2, "0")}:${time[2]}`;
  return { local_date: localDate, start_time_24h: startTime, starts_at: `${localDate}T${startTime}:00-07:00` };
}

function searchableText(event: Event): string {
  return [event.title, event.host, event.neighborhood, event.labels.join(" ")].join(" ");
}

function matchedTopics(event: Event): Topic[] {
  const text = searchableText(event);
  return TOPICS.filter((topic) => TOPIC_PATTERNS[topic].test(text));
}

export function toSearchEvent(event: Event, hostQueries: string[] = []): SearchEvent {
  const normalizedHost = event.host.toLocaleLowerCase();
  return {
    ...event,
    event_id: new URL(event.event_url).pathname.split("/").at(-1)!,
    ...calendarFields(event),
    timezone: EVENT_TIMEZONE,
    end_time_known: false,
    matched_topics: matchedTopics(event),
    matched_host_queries: hostQueries.filter((query) => normalizedHost.includes(query.trim().toLocaleLowerCase())),
  };
}

export function getEvent(events: Event[], eventId: string): SearchEvent | undefined {
  return events.map((event) => toSearchEvent(event)).find((event) => event.event_id === eventId);
}

function countValues(values: string[]): FacetValue[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function listFacets(events: Event[]) {
  const enriched = events.map((event) => toSearchEvent(event));
  return {
    dates: countValues(enriched.map((event) => event.local_date)),
    hosts: countValues(events.flatMap((event) => event.host.split(",").map((host) => host.trim())).filter(Boolean)),
    neighborhoods: countValues(events.map((event) => event.neighborhood)),
    labels: countValues(events.flatMap((event) => event.labels)),
    topics: TOPICS.map((topic) => ({ value: topic, count: enriched.filter((event) => event.matched_topics.includes(topic)).length })),
  };
}

export function loadCatalog(): Catalog {
  const catalog = catalogJson as Catalog;
  for (const event of catalog.events) {
    if (!isTechWeekEventUrl(event.event_url)) throw new Error(`Catalog contains an invalid Tech Week event URL at source row ${event.source_row}.`);
    calendarFields(event);
  }
  return catalog;
}

export function searchEvents(events: Event[], options: SearchOptions): SearchResult {
  const queryTerms = (options.query ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const dates = new Set(options.dates ?? []);
  const neighborhoods = (options.neighborhoods ?? []).map((value) => value.toLocaleLowerCase());
  const hostQueries = (options.hosts_any ?? []).map((value) => ({
    original: value,
    normalized: value.trim().toLocaleLowerCase(),
  }));
  const matches: SearchEvent[] = [];

  for (const event of events) {
    const text = searchableText(event).toLocaleLowerCase();
    const calendar = calendarFields(event);
    const topics = matchedTopics(event);
    const normalizedHost = event.host.toLocaleLowerCase();
    const matchedHostQueries = hostQueries
      .filter(({ normalized }) => normalizedHost.includes(normalized))
      .map(({ original }) => original);
    if (queryTerms.some((term) => !text.includes(term))) continue;
    if (options.topic && !topics.includes(options.topic)) continue;
    if (dates.size > 0 && !dates.has(calendar.local_date)) continue;
    if (options.start_time_from && calendar.start_time_24h < options.start_time_from) continue;
    if (options.start_time_to && calendar.start_time_24h > options.start_time_to) continue;
    if (neighborhoods.length > 0 && !neighborhoods.includes(event.neighborhood.toLocaleLowerCase())) continue;
    if (hostQueries.length > 0 && matchedHostQueries.length === 0) continue;
    if (!options.include_closed && event.labels.some((label) => label.toLocaleLowerCase() === "closed")) continue;

    matches.push({ ...toSearchEvent(event, matchedHostQueries), matched_topics: topics });
  }
  return { events: matches.slice(0, options.limit), total_matches: matches.length, truncated: matches.length > options.limit };
}

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function isClockTime(value: string): boolean {
  return CLOCK_TIME.test(value);
}
