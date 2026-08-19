#!/usr/bin/env node
// Invoked from the build-safari job in .github/workflows/release.yml (which
// runs on macos-latest — Fastlane/Xcode aren't available on the ubuntu
// runner the Chrome/Firefox publish steps use). See
// safari-app/fastlane/Fastfile for what this actually runs, and its header
// comment for what's still unverified (the iOS lane specifically).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Must match exactly what safari-app/fastlane/Fastfile reads via ENV.fetch.
const required = [
  'APP_STORE_CONNECT_KEY_ID',
  'APP_STORE_CONNECT_ISSUER_ID',
  'APP_STORE_CONNECT_P8',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.warn(`Skipping App Store upload; missing App Store Connect secrets: ${missing.join(', ')}`);
  process.exit(0);
}

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: node scripts/publish-safari.mjs <path-to-zip>');
  process.exit(1);
}

if (!existsSync(zipPath)) {
  console.error(`Safari package not found: ${zipPath}`);
  process.exit(1);
}

if (process.platform !== 'darwin') {
  console.warn(`Skipping App Store upload; this must run on macOS (Xcode is required), not ${process.platform}.`);
  console.warn(`Safari package ready for App Store Connect: ${zipPath}`);
  process.exit(0);
}

const fastlaneDir = path.join(root, 'safari-app');
const fastlaneCheck = spawnSync('fastlane', ['--version'], { stdio: 'ignore' });
if (fastlaneCheck.error || fastlaneCheck.status !== 0) {
  console.warn('Skipping App Store upload; `fastlane` is not installed (gem install fastlane).');
  console.warn(`Safari package ready for App Store Connect: ${zipPath}`);
  process.exit(0);
}

// macOS goes to the App Store (unreleased draft, not submitted for review);
// iOS goes to TestFlight (matches how this app has been distributed on iOS
// so far). Independent platforms/lanes — run both by default, don't let
// one's failure stop the other from being attempted, but fail the whole
// script if either did.
//
// Override with NOVEL_TRACKER_SAFARI_PLATFORMS (comma-separated: "mac",
// "ios", or "mac,ios") to publish just one — e.g. when the other platform's
// App Store Connect listing is in a state that blocks new versions (a
// pending version with unresolved review feedback has to be manually pushed
// back to "Waiting for Review" before the API can create another one; no
// flag here can skip that).
const requestedPlatforms = (process.env.NOVEL_TRACKER_SAFARI_PLATFORMS || 'mac,ios')
  .split(',')
  .map((platform) => platform.trim())
  .filter(Boolean);

const invalidPlatforms = requestedPlatforms.filter((platform) => !['mac', 'ios'].includes(platform));
if (invalidPlatforms.length > 0) {
  console.error(`Invalid NOVEL_TRACKER_SAFARI_PLATFORMS entries: ${invalidPlatforms.join(', ')} (expected "mac" and/or "ios")`);
  process.exit(1);
}

let exitCode = 0;
for (const platform of requestedPlatforms) {
  console.log(`Running fastlane ${platform} release from ${fastlaneDir} (safari-app/fastlane/Fastfile)...`);
  const result = spawnSync('fastlane', [platform, 'release'], {
    cwd: fastlaneDir,
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) exitCode = result.status;
}

process.exit(exitCode);
