#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAmoClient } from './amo-api.mjs';
import { SCREENSHOT_SETS, loadReleasePlan, packageVersion, shouldUploadScreenshots } from './release-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const required = ['AMO_API_KEY', 'AMO_API_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing Firefox AMO configuration: ${missing.join(', ')}`);
  process.exit(1);
}

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: node scripts/publish-firefox.mjs <path-to-zip>');
  process.exit(1);
}

if (!existsSync(zipPath)) {
  console.error(`Firefox package not found: ${zipPath}`);
  process.exit(1);
}

const plan = loadReleasePlan(packageVersion());
if (plan.errors.length) {
  console.error(`Cannot publish Firefox ${plan.version}; its release plan is incomplete:`);
  for (const error of plan.errors) console.error(`  - ${error}`);
  process.exit(1);
}

// AMO's screenshot size for extensions. The Mac App Store captures are the
// same 16:10 pages, so they're scaled down rather than kept twice.
const PREVIEW_SIZE = { width: 1280, height: 800 };

async function previewImages() {
  const { default: sharp } = await import('sharp');
  const images = [];
  for (const directory of SCREENSHOT_SETS.firefox) {
    const files = readdirSync(path.join(root, directory)).filter((name) => /\.(jpe?g|png)$/i.test(name)).sort();
    for (const name of files) {
      const data = await sharp(path.join(root, directory, name))
        .resize(PREVIEW_SIZE.width, PREVIEW_SIZE.height, { fit: 'cover' })
        .jpeg({ quality: 88 })
        .toBuffer();
      images.push({ name: name.replace(/\.\w+$/, '.jpg'), data });
    }
  }
  return images;
}

// `web-ext sign` builds and submits from a source *directory* — it has no
// flag to accept a pre-built zip directly (confirmed against `web-ext sign
// --help`: only `-s, --source-dir` exists). Unpack the packaged zip into a
// scratch directory and point web-ext at that instead.
const sourceDir = await mkdtemp(path.join(tmpdir(), 'novel-tracker-firefox-source-'));

let exitCode = 0;
try {
  const unzipResult = spawnSync('unzip', ['-q', zipPath, '-d', sourceDir], { stdio: 'inherit' });
  if (unzipResult.error) throw unzipResult.error;

  if (unzipResult.status !== 0) {
    console.error(`Failed to unpack Firefox package: ${zipPath}`);
    exitCode = unzipResult.status ?? 1;
  } else {
    const manifest = JSON.parse(await readFile(path.join(sourceDir, 'manifest.json'), 'utf8'));
    const addonId = manifest.browser_specific_settings?.gecko?.id;
    if (!addonId) throw new Error('The Firefox package has no gecko id');
    const amo = createAmoClient({ key: process.env.AMO_API_KEY, secret: process.env.AMO_API_SECRET, addonId });
    const { default_locale: locale = 'en-US' } = await amo.getAddon();

    // A re-run of a release whose version AMO already took (because a later
    // step or another store failed) skips the upload AMO would refuse as a
    // duplicate, and carries on with the steps after it.
    if (await amo.hasVersion(plan.version)) {
      console.log(`AMO already has ${plan.version}; not uploading it again.`);
    } else {
      const metadataPath = path.join(sourceDir, '..', `${path.basename(sourceDir)}-amo-metadata.json`);
      await writeFile(metadataPath, JSON.stringify({ version: { release_notes: { [locale]: plan.notes.firefox } } }));

      const result = spawnSync(
        'npm',
        [
          'exec',
          '--',
          'web-ext',
          'sign',
          '--source-dir',
          sourceDir,
          // Public, searchable AMO listing (novel-tracker@bghimire.com) rather
          // than a self-distributed unlisted build — matches how this
          // extension has been published so far. `--channel` is required by
          // web-ext; there is no default.
          '--channel',
          'listed',
          '--api-key',
          process.env.AMO_API_KEY,
          '--api-secret',
          process.env.AMO_API_SECRET,
          // Release notes for this version, under the listing's own language.
          '--amo-metadata',
          metadataPath,
        ],
        {
          stdio: 'inherit',
        },
      );

      await rm(metadataPath, { force: true });
      if (result.error) throw result.error;
      exitCode = result.status ?? 0;
    }

    // Screenshots belong to the listing rather than the version; replace
    // them only once the version itself went through, and only if changed.
    if (exitCode === 0 && shouldUploadScreenshots(plan, 'firefox')) {
      const { added, removed } = await amo.replacePreviews(await previewImages());
      console.log(`Replaced the Firefox listing's screenshots (${removed} old, ${added} new).`);
    } else if (exitCode === 0) {
      console.log("Kept the Firefox listing's current screenshots.");
    }
  }
} finally {
  await rm(sourceDir, { recursive: true, force: true });
}

process.exit(exitCode);
