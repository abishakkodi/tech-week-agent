import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicFile = (name: string) => new URL(`../public/${name}`, import.meta.url);

test("publishes crawler and agent discovery files", async () => {
  const [robots, llms] = await Promise.all([
    readFile(publicFile("robots.txt"), "utf8"),
    readFile(publicFile("llms.txt"), "utf8"),
  ]);
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(llms, /https:\/\/tech-week-agent\.abishak-kodi\.workers\.dev\/mcp/);
  assert.match(llms, /`sf` is the default, `la` searches Los Angeles, and `all` searches both catalogs/);
  assert.match(llms, /This server has no access to private calendars/);
});
