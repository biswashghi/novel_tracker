#!/usr/bin/env node
// What a version's release does on the stores, and the notes it ships with.
// Lives next to the version in docs/release/notes/<version>/ so it is
// written, and reviewed, in the same pull request as the version bump
// (merging that pull request is the release; see AGENTS.md).
//
//   docs/release/notes/<version>/
//     app-store-ios.txt   "What's New" for iPhone and iPad
//     app-store-mac.txt   "What's New" for the Mac
//     firefox.txt         Release notes on the Firefox Add-ons version
//     chrome.txt          optional: "What's new" for the Chrome listing,
//                         which the release summary shows for pasting (the
//                         Chrome Web Store API can't edit listings)
//     release.json        optional overrides:
//                           "apple": "testflight"  stop at TestFlight
//                             instead of submitting for App Review
//                           "screenshots": true | false  always / never
//                             replace store screenshots (default: only
//                             the ones that changed since the last release)
//
// Usage: node scripts/release-plan.mjs check [--base-ref=<ref>]
//   Validates the plan for package.json's version. With --base-ref, only
//   when the version differs from that ref's (i.e. in a release PR).
//   scripts/publish-safari.mjs reads the plan through loadReleasePlan().
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const APPLE_DISTRIBUTIONS = Object.freeze(["app-store", "testflight"]);
// App Store Connect's limit for "What's New in This Version". AMO's release
// notes and the Chrome description allow more; the same cap keeps them brief.
export const MAX_NOTES = 4000;
const NOTE_FILES = Object.freeze({
  ios: "app-store-ios.txt",
  mac: "app-store-mac.txt",
  firefox: "firefox.txt",
  chrome: "chrome.txt"
});
const APPLE_NOTES = new Set(["ios", "mac"]);

export function notesDirectory(version, base = root) {
  return path.join(base, "docs", "release", "notes", version);
}

function readNotes(file) {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").trim();
}

/**
 * The release plan for `version`, with every problem that would stop it
 * listed in `errors` rather than thrown, so a check can report them all.
 */
export function loadReleasePlan(version, base = root) {
  const directory = notesDirectory(version, base);
  const errors = [];

  let config = {};
  const configPath = path.join(directory, "release.json");
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (error) {
      errors.push(`${path.relative(base, configPath)} is not valid JSON: ${error.message}`);
    }
    const unknown = Object.keys(config).filter((key) => !["apple", "screenshots"].includes(key));
    if (unknown.length) errors.push(`${path.relative(base, configPath)} has unknown keys: ${unknown.join(", ")}`);
  }

  const apple = config.apple ?? "app-store";
  const screenshots = config.screenshots ?? "changed";
  if (![true, false, "changed"].includes(screenshots)) {
    errors.push(`"screenshots" must be true or false, not ${JSON.stringify(screenshots)}`);
  }
  if (!APPLE_DISTRIBUTIONS.includes(apple)) {
    errors.push(`"apple" must be one of ${APPLE_DISTRIBUTIONS.join(", ")}, not ${JSON.stringify(apple)}`);
  }

  const notes = {};
  const notePaths = {};
  for (const [platform, filename] of Object.entries(NOTE_FILES)) {
    const file = path.join(directory, filename);
    const text = readNotes(file);
    notePaths[platform] = text ? file : "";
    notes[platform] = text || "";
    const where = path.relative(base, file);
    // App Review needs "What's New" for every update. TestFlight builds can
    // go without it; if it is there it becomes the build's "What to Test".
    // Firefox notes are always published, so always required; Chrome's are
    // for pasting by hand and optional.
    const required = platform === "firefox" || (APPLE_NOTES.has(platform) && apple === "app-store");
    if (!text && required) errors.push(`${where} is missing or empty`);
    if (text && text.length > MAX_NOTES) {
      errors.push(`${where} is ${text.length} characters; keep it under ${MAX_NOTES}`);
    }
  }

  return { version, apple, screenshots, notes, notePaths, errors };
}

// Store screenshots, per listing, in upload order within each directory.
export const SCREENSHOT_SETS = Object.freeze({
  ios: ["store-assets/app-store/ios", "store-assets/app-store/ipad"],
  mac: ["store-assets/app-store/macos"],
  // Firefox shows the Mac captures (16:10 pages of the extension itself).
  firefox: ["store-assets/app-store/macos"]
});

/** The most recent vX.Y.Z tag reachable from HEAD other than `version`'s own. */
export function previousReleaseTag(version, cwd = root) {
  try {
    const tags = execFileSync("git", ["tag", "--merged", "HEAD", "--list", "v*", "--sort=-v:refname"], {
      cwd,
      encoding: "utf8"
    }).split("\n").map((tag) => tag.trim()).filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
    return tags.find((tag) => tag !== `v${version}`) || null;
  } catch {
    return null;
  }
}

/**
 * Whether `listing`'s screenshots should be replaced in this release: as
 * release.json says, or else if they changed since the previous release (or
 * there is no previous release to compare with).
 */
export function shouldUploadScreenshots(plan, listing, cwd = root) {
  if (plan.screenshots !== "changed") return plan.screenshots;
  const previous = previousReleaseTag(plan.version, cwd);
  if (!previous) return true;
  try {
    execFileSync("git", ["diff", "--quiet", previous, "HEAD", "--", ...SCREENSHOT_SETS[listing]], { cwd });
    return false;
  } catch {
    return true;
  }
}

export function packageVersion(ref) {
  if (!ref) return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  try {
    return JSON.parse(execFileSync("git", ["show", `${ref}:package.json`], { cwd: root, encoding: "utf8" })).version;
  } catch {
    return null;
  }
}

function main(argv) {
  const [command, ...options] = argv;
  const baseRef = options.find((option) => option.startsWith("--base-ref="))?.slice("--base-ref=".length);
  const version = packageVersion();

  if (command === "check") {
    if (baseRef && packageVersion(baseRef) === version) {
      console.log(`Version ${version} is unchanged from ${baseRef}; no release plan to check.`);
      return 0;
    }
    const plan = loadReleasePlan(version);
    if (plan.errors.length) {
      console.error(`Release plan for ${version} (docs/release/notes/${version}/) is incomplete:`);
      for (const error of plan.errors) console.error(`  - ${error}`);
      return 1;
    }
    const target = plan.apple === "testflight" ? "TestFlight only" : "submitted for App Review, released on approval";
    console.log(`Release plan for ${version}: Apple ${target}.`);
    return 0;
  }

  console.error("Usage: release-plan.mjs check [--base-ref=<ref>]");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
