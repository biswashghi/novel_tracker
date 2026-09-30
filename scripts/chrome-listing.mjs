#!/usr/bin/env node
// The Chrome Web Store API can upload and publish a package but can't edit
// the listing, so its text and screenshots are the one manual store step.
// This prepares them: it writes the release's Chrome notes to the workflow
// summary for pasting, and when the store screenshots changed, puts
// 1280x800 copies in <out-dir> for the release to attach as an artifact.
//
// Usage: node scripts/chrome-listing.mjs <out-dir>
import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCREENSHOT_SETS, loadReleasePlan, packageVersion, shouldUploadScreenshots } from "./release-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || "chrome-listing");
const plan = loadReleasePlan(packageVersion());
const lines = [`## Chrome Web Store listing for ${plan.version}`, ""];

if (plan.notes.chrome) {
  lines.push(
    "The API can't edit the listing. Paste this at the top of the description in the",
    "[developer dashboard](https://chrome.google.com/webstore/devconsole), replacing the previous release's:",
    "",
    "```",
    plan.notes.chrome,
    "```",
    ""
  );
} else {
  lines.push("No `chrome.txt` for this version, so the listing text stays as it is.", "");
}

// Chrome shows the same captures as Firefox.
if (shouldUploadScreenshots(plan, "firefox")) {
  const { default: sharp } = await import("sharp");
  mkdirSync(outDir, { recursive: true });
  let count = 0;
  for (const directory of SCREENSHOT_SETS.firefox) {
    for (const name of readdirSync(path.join(root, directory)).filter((file) => /\.(jpe?g|png)$/i.test(file)).sort()) {
      await sharp(path.join(root, directory, name))
        .resize(1280, 800, { fit: "cover" })
        .jpeg({ quality: 88 })
        .toFile(path.join(outDir, name.replace(/\.\w+$/, ".jpg")));
      count += 1;
    }
  }
  lines.push(
    `The store screenshots changed since the last release: the **chrome-listing** artifact has ${count} at 1280x800,`,
    "in order, to replace the listing's screenshots with.",
    ""
  );
} else {
  lines.push("The store screenshots haven't changed since the last release.", "");
}

const summary = lines.join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
console.log(summary);
