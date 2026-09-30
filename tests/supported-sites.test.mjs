import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { autoTrackedPatterns, isAutoTrackedUrl, matchesPattern } from "../src/lib/supported-sites.js";

const manifest = JSON.parse(await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"));
const manifestPatterns = manifest.content_scripts.flatMap((script) => script.matches);

test("a wildcard subdomain pattern matches the bare domain and any subdomain", () => {
  assert.equal(matchesPattern("https://www.royalroad.com/fiction/1/x/chapter/2", "https://*.royalroad.com/*"), true);
  assert.equal(matchesPattern("https://royalroad.com/fiction/1", "https://*.royalroad.com/*"), true);
  assert.equal(matchesPattern("https://m.webnovel.com/book/1", "https://*.webnovel.com/*"), true);
});

test("a wildcard subdomain pattern does not match a lookalike domain", () => {
  assert.equal(matchesPattern("https://notroyalroad.com/fiction/1", "https://*.royalroad.com/*"), false);
  assert.equal(matchesPattern("https://royalroad.com.evil.test/fiction/1", "https://*.royalroad.com/*"), false);
});

test("an exact host pattern matches only that host", () => {
  assert.equal(matchesPattern("https://chikari.moe/novel/1", "https://chikari.moe/*"), true);
  assert.equal(matchesPattern("https://www.chikari.moe/novel/1", "https://chikari.moe/*"), false);
});

test("the scheme must match", () => {
  assert.equal(matchesPattern("http://www.royalroad.com/fiction/1", "https://*.royalroad.com/*"), false);
  assert.equal(matchesPattern("http://example.com/", "*://example.com/*"), true);
  assert.equal(matchesPattern("ftp://example.com/", "*://example.com/*"), false);
});

test("the path glob is honoured", () => {
  assert.equal(matchesPattern("https://example.com/read/1", "https://example.com/read/*"), true);
  assert.equal(matchesPattern("https://example.com/other/1", "https://example.com/read/*"), false);
});

test("malformed input never matches", () => {
  assert.equal(matchesPattern("not a url", "https://*.royalroad.com/*"), false);
  assert.equal(matchesPattern("https://www.royalroad.com/", "<all_urls>"), false);
});

test("every supported site in the manifest is recognised as auto-tracked", () => {
  assert.equal(isAutoTrackedUrl("https://www.royalroad.com/fiction/1/x/chapter/2", manifestPatterns), true);
  assert.equal(isAutoTrackedUrl("https://archiveofourown.org/works/1/chapters/2", manifestPatterns), true);
  assert.equal(isAutoTrackedUrl("https://chikari.moe/novel/1/2", manifestPatterns), true);
});

test("a site outside the manifest is not auto-tracked", () => {
  assert.equal(isAutoTrackedUrl("https://some-translator.blogspot.com/chapter-2", manifestPatterns), false);
});

test("with no patterns available the answer is unknown rather than a guess", () => {
  assert.equal(isAutoTrackedUrl("https://www.royalroad.com/fiction/1", []), null);
});

test("patterns are read from the running extension's manifest", () => {
  const api = { runtime: { getManifest: () => ({ content_scripts: [{ matches: ["https://a.test/*"] }, { matches: ["https://b.test/*"] }] }) } };
  assert.deepEqual(autoTrackedPatterns(api), ["https://a.test/*", "https://b.test/*"]);
  assert.deepEqual(autoTrackedPatterns({}), []);
  assert.deepEqual(autoTrackedPatterns(null), []);
});
