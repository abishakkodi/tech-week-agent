import type { SearchEvent } from "./catalog.js";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const CLOSED = /\b(?:registration is closed|registrations? closed|event is closed)\b/i;
const SOLD_OUT = /\b(?:sold out|fully booked|at capacity)\b/i;
const WAITLIST = /\b(?:join (?:the )?waitlist|waitlist only|on the waitlist)\b/i;
const OPEN = /\b(?:register now|request to join|rsvp|join event)\b/i;
const PRIVATE_IPV4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/;

export type RegistrationSignal = "open" | "waitlist" | "sold_out" | "closed" | "unknown";
export type LiveEventDetails = {
  event_id: string;
  tech_week_url: string;
  final_url: string;
  title: string | null;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
  observed_registration_signal: RegistrationSignal;
  fetched_at: string;
};

function publicHttpsUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLocaleLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Event destination must be a standard HTTPS URL.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "::1" || PRIVATE_IPV4.test(host)) {
    throw new Error("Event destination uses a private or local address.");
  }
  return url;
}

function decodeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return decodeHtml(match[1].trim()).slice(0, 2_000);
  }
  return null;
}

function findEventJson(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) { const found = findEventJson(item); if (found) return found; }
  } else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
    if (types.some((type) => type === "Event")) return object;
    for (const child of Object.values(object)) { const found = findEventJson(child); if (found) return found; }
  }
  return null;
}

function jsonLdEvent(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const found = findEventJson(JSON.parse(decodeHtml(match[1]))); if (found) return found; } catch { /* Ignore malformed third-party metadata. */ }
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 2_000) : null;
}

export function parseLiveDetails(event: SearchEvent, finalUrl: string, html: string, fetchedAt = new Date().toISOString()): LiveEventDetails {
  const structured = jsonLdEvent(html);
  const location = structured?.location && typeof structured.location === "object" ? structured.location as Record<string, unknown> : null;
  const addressValue = location?.address;
  const address = typeof addressValue === "string" ? addressValue : addressValue && typeof addressValue === "object"
    ? Object.values(addressValue as Record<string, unknown>).filter((part) => typeof part === "string").join(", ") : null;
  const visibleText = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const observed_registration_signal: RegistrationSignal = CLOSED.test(visibleText) ? "closed" : SOLD_OUT.test(visibleText) ? "sold_out"
    : WAITLIST.test(visibleText) ? "waitlist" : OPEN.test(visibleText) ? "open" : "unknown";
  return {
    event_id: event.event_id,
    tech_week_url: event.event_url,
    final_url: finalUrl,
    title: text(structured?.name) ?? meta(html, "og:title"),
    description: text(structured?.description) ?? meta(html, "og:description") ?? meta(html, "description"),
    starts_at: text(structured?.startDate),
    ends_at: text(structured?.endDate),
    venue_name: text(location?.name),
    venue_address: text(address),
    observed_registration_signal,
    fetched_at: fetchedAt,
  };
}

export async function fetchLiveEventDetails(event: SearchEvent, fetcher: typeof fetch = fetch): Promise<LiveEventDetails> {
  let current = publicHttpsUrl(event.event_url);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { Accept: "text/html" } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("Event redirect omitted its destination.");
    if (redirects === 5) throw new Error("Event page exceeded the redirect limit.");
    current = publicHttpsUrl(new URL(location, current).toString());
  }
  if (!response) throw new Error("Event page could not be fetched.");
  if (!response.ok) throw new Error(`Event page returned HTTP ${response.status}.`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("Event destination did not return HTML.");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_HTML_BYTES) throw new Error("Event page is too large to inspect safely.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_HTML_BYTES) throw new Error("Event page is too large to inspect safely.");
  return parseLiveDetails(event, current.toString(), new TextDecoder().decode(bytes));
}
