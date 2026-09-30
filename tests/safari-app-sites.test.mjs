import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The iOS app lists the sites the extension follows automatically. Keep that
// list in step with the content scripts, so the app never promises a site
// the extension doesn't track (or leaves one out).
const manifest = JSON.parse(await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"));
const swift = await readFile(new URL("../safari-native/SafariAppViewController.swift", import.meta.url), "utf8");

const manifestDomains = manifest.content_scripts
  .flatMap((script) => script.matches)
  .map((pattern) => new URL(pattern.replace("*.", "")).hostname)
  .sort();

const appDomains = [...swift.matchAll(/\("[^"]+", "([a-z0-9.-]+)"\)/g)].map((match) => match[1]).sort();

test("the app's supported-site list matches the extension's content scripts", () => {
  assert.deepEqual(appDomains, manifestDomains);
});
