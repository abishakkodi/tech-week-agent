import type { SearchEvent } from "./catalog.js";

export type ScoredEvent = { event: SearchEvent; score: number; reasons: string[] };
export type AvailabilityWindow = { starts_at: string; ends_at: string };

const WORD = /[a-z0-9]+/g;
const STOP_WORDS = new Set(["and", "for", "from", "into", "the", "with", "tech", "week", "sf", "la"]);

function words(value: string): Set<string> {
  return new Set((value.toLocaleLowerCase().match(WORD) ?? []).filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

function overlap(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => right.has(value));
}

function minuteDifference(left: string, right: string): number {
  return Math.abs(Date.parse(left) - Date.parse(right)) / 60_000;
}

export function similarEvents(events: SearchEvent[], eventId: string, limit: number): ScoredEvent[] {
  const source = events.find((event) => event.event_id === eventId);
  if (!source) throw new Error("Event not found in this snapshot.");
  const sourceWords = words(`${source.title} ${source.host}`);
  return events.filter((event) => event.event_id !== eventId).map((event) => {
    const reasons: string[] = [];
    let score = 0;
    const commonTopics = event.matched_topics.filter((topic) => source.matched_topics.includes(topic));
    if (commonTopics.length) { score += commonTopics.length * 5; reasons.push(`shared topic: ${commonTopics.join(", ")}`); }
    if (event.host.toLocaleLowerCase() === source.host.toLocaleLowerCase()) { score += 5; reasons.push("same host"); }
    if (event.neighborhood === source.neighborhood) { score += 2; reasons.push("same neighborhood"); }
    const commonWords = overlap(sourceWords, words(`${event.title} ${event.host}`));
    if (commonWords.length) { score += Math.min(commonWords.length, 4); reasons.push(`shared terms: ${commonWords.slice(0, 4).join(", ")}`); }
    if (event.local_date === source.local_date) { score += 1; reasons.push("same day"); }
    return { event, score, reasons };
  }).filter((result) => result.score > 0).sort((a, b) => b.score - a.score || a.event.starts_at.localeCompare(b.event.starts_at)).slice(0, limit);
}

export function alternativeEvents(events: SearchEvent[], eventId: string, limit: number, maxMinutes: number): ScoredEvent[] {
  const source = events.find((event) => event.event_id === eventId);
  if (!source) throw new Error("Event not found in this snapshot.");
  return similarEvents(events, eventId, events.length).map((candidate) => {
    const difference = minuteDifference(source.starts_at, candidate.event.starts_at);
    const sameDay = source.local_date === candidate.event.local_date;
    const score = candidate.score + (sameDay ? 4 : 0) + Math.max(0, 4 - difference / 60);
    const reasons = [...candidate.reasons, ...(sameDay ? [`${Math.round(difference)} minutes from the original start`] : [])];
    return { ...candidate, score: Math.round(score * 100) / 100, reasons };
  }).filter((candidate) => candidate.event.local_date === source.local_date && minuteDifference(source.starts_at, candidate.event.starts_at) <= maxMinutes)
    .sort((a, b) => b.score - a.score || a.event.starts_at.localeCompare(b.event.starts_at)).slice(0, limit);
}

export function buildItinerary(events: SearchEvent[], windows: AvailabilityWindow[], durationMinutes: number, bufferMinutes: number, maxEvents: number) {
  const durationMs = durationMinutes * 60_000;
  const bufferMs = bufferMinutes * 60_000;
  const selected: Array<SearchEvent & { assumed_ends_at: string }> = [];
  const rejected: Array<{ event_id: string; reason: string }> = [];
  for (const event of [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    if (selected.length >= maxEvents) { rejected.push({ event_id: event.event_id, reason: "maximum itinerary size reached" }); continue; }
    const starts = Date.parse(event.starts_at);
    const ends = starts + durationMs;
    const fitsWindow = windows.some((window) => starts >= Date.parse(window.starts_at) && ends <= Date.parse(window.ends_at));
    if (!fitsWindow) { rejected.push({ event_id: event.event_id, reason: "does not fit an availability window using the assumed duration" }); continue; }
    const overlaps = selected.some((chosen) => starts < Date.parse(chosen.assumed_ends_at) + bufferMs && ends + bufferMs > Date.parse(chosen.starts_at));
    if (overlaps) { rejected.push({ event_id: event.event_id, reason: "overlaps a selected event including the requested buffer" }); continue; }
    selected.push({ ...event, assumed_ends_at: new Date(ends).toISOString() });
  }
  return { selected, rejected, assumptions: [`Each event lasts ${durationMinutes} minutes.`, `A ${bufferMinutes}-minute buffer is required between events.`, "Travel time and venue coordinates are not available."] };
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function utcStamp(value: number): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createIcs(events: SearchEvent[], durationMinutes: number): string {
  const created = utcStamp(Date.now());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SF Tech Week MCP//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const event of events) {
    const start = Date.parse(event.starts_at);
    lines.push("BEGIN:VEVENT", `UID:${icsEscape(event.event_id)}@tech-week-agent`, `DTSTAMP:${created}`, `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(start + durationMinutes * 60_000)}`, `SUMMARY:${icsEscape(event.title)}`, `DESCRIPTION:${icsEscape(`Hosted by ${event.host}. Source: ${event.event_url}`)}`, `LOCATION:${icsEscape(event.neighborhood)}`, `URL:${event.event_url}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function networkingMatches(events: SearchEvent[], companies: string[], limit: number) {
  return events.map((event) => {
    const normalizedHost = event.host.toLocaleLowerCase();
    const normalizedTitle = event.title.toLocaleLowerCase();
    const host_matches = companies.filter((company) => normalizedHost.includes(company.toLocaleLowerCase()));
    const title_mentions = companies.filter((company) => !host_matches.includes(company) && normalizedTitle.includes(company.toLocaleLowerCase()));
    return { event, host_matches, title_mentions };
  }).filter((result) => result.host_matches.length || result.title_mentions.length).slice(0, limit);
}
