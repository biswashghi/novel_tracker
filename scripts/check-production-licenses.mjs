#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const allowedLicenses = new Set(["0BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MIT"]);
const violations = [];
let checked = 0;

for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
  if (!packagePath.includes("node_modules/") || metadata.dev === true) continue;
  checked += 1;
  if (!allowedLicenses.has(metadata.license)) {
    violations.push(`${packagePath} (${metadata.version || "unknown version"}): ${metadata.license || "missing license"}`);
  }
}

if (checked === 0) throw new Error("No production dependencies were found in package-lock.json.");
if (violations.length > 0) {
  throw new Error(`Unapproved production dependency licenses:\n${violations.join("\n")}`);
}

console.log(`Approved licenses verified for ${checked} production dependency records.`);
