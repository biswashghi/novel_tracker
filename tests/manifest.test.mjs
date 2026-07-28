import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"));

const supportedHostPatterns = [
  "https://*.royalroad.com/*",
  "https://*.patreon.com/*",
  "https://*.wuxiaworld.com/*",
  "https://*.novelbin.com/*",
  "https://*.scribblehub.com/*",
  "https://*.creativenovels.com/*",
  "https://*.lightnovelstranslations.com/*",
  "https://*.shintranslations.com/*"
];

test("manifest limits automatic host access to supported novel sites", () => {
  assert.deepEqual(manifest.host_permissions, supportedHostPatterns);
  assert.deepEqual(manifest.content_scripts[0].matches, supportedHostPatterns);
  assert.ok(!manifest.host_permissions.includes("http://*/*"));
  assert.ok(!manifest.host_permissions.includes("https://*/*"));
});
