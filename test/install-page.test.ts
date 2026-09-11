import assert from "node:assert/strict";
import test from "node:test";
import { installPage } from "../src/install-page.js";

test("renders client installation actions from the deployment origin", () => {
  const html = installPage("https://events.example.com");
  assert.match(html, /codex mcp add sf-tech-week --url https:\/\/events\.example\.com\/mcp/);
  assert.match(html, /claude mcp add --transport http sf-tech-week https:\/\/events\.example\.com\/mcp/);
  assert.match(html, /cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=sf-tech-week/);
  assert.match(html, />Cursor<\/a>/);
  assert.match(html, /id="install-command"/);
  assert.match(html, /data-client="codex"/);
  assert.match(html, /data-client="claude"/);
  assert.match(html, /data-client="config"/);
  assert.match(html, /<img class="background" src="\/golden-gate-watercolor\.png" alt=""/);
  assert.doesNotMatch(html, /Useful by design|check_rsvp_status/);
});

test("escapes an unexpected origin before inserting it into HTML", () => {
  const html = installPage('https://example.com\"><script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /\\u003cscript\\u003ealert\(1\)\\u003c\/script\\u003e/);
});
