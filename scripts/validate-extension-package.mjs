#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [zipArgument, platform, versionArgument] = process.argv.slice(2);
if (!zipArgument || !["chrome", "firefox"].includes(platform)) {
  throw new Error("Usage: validate-extension-package.mjs <zip> <chrome|firefox> [expected-version]");
}

const zipPath = path.resolve(zipArgument);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const expectedVersion = versionArgument || packageJson.version;

function unzip(args) {
  const result = spawnSync("unzip", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `unzip ${args.join(" ")} failed`);
  return result.stdout;
}

const entries = unzip(["-Z1", zipPath]).split("\n").filter(Boolean);
if (!entries.includes("manifest.json")) throw new Error("Package has no root manifest.json.");

const forbiddenPath = /(^|\/)(?:__MACOSX|node_modules|tests?|\.git|\.env(?:\.|$))|\.(?:map|pem|p12|mobileprovision)$/i;
for (const entry of entries) {
  if (entry.startsWith("/") || entry.split("/").includes("..")) {
    throw new Error(`Package contains an unsafe path: ${entry}`);
  }
  if (forbiddenPath.test(entry)) throw new Error(`Package contains forbidden development material: ${entry}`);
}

const manifest = JSON.parse(unzip(["-p", zipPath, "manifest.json"]));
if (manifest.version !== expectedVersion) {
  throw new Error(`Manifest version ${manifest.version} does not match expected ${expectedVersion}.`);
}
if (manifest.manifest_version !== 3) throw new Error("Store packages must use Manifest V3.");
if (platform === "firefox" && !manifest.browser_specific_settings?.gecko?.id) {
  throw new Error("Firefox package is missing its stable Gecko extension ID.");
}
if (platform === "firefox") {
  const collection = manifest.browser_specific_settings.gecko.data_collection_permissions;
  const expectedOptional = [
    "authenticationInfo",
    "browsingActivity",
    "personallyIdentifyingInfo",
    "websiteActivity",
    "websiteContent"
  ];
  if (collection?.required?.join(",") !== "none") {
    throw new Error("Firefox package must keep local-only use free of required data collection.");
  }
  if ([...(collection?.optional || [])].sort().join(",") !== expectedOptional.join(",")) {
    throw new Error("Firefox package has incomplete optional synchronization data declarations.");
  }
}
if (platform === "chrome" && manifest.browser_specific_settings) {
  throw new Error("Chrome package contains Firefox-only browser settings.");
}

const textEntries = entries.filter((entry) => /\.(?:css|html|js|json|txt)$/i.test(entry));
const forbiddenContent = [
  /localhost:879[23]/i,
  /novel-tracker-e2e-(?:password|admin|client)/i,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /e2e-tester@example\.com/i
];
for (const entry of textEntries) {
  const contents = unzip(["-p", zipPath, entry]);
  for (const pattern of forbiddenContent) {
    if (pattern.test(contents)) throw new Error(`Package contains forbidden content in ${entry}: ${pattern}`);
  }
}

console.log(`Validated ${platform} package ${path.basename(zipPath)} at version ${expectedVersion}.`);
