#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
    const result = spawnSync(
      'npx',
      [
        '-y',
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
      ],
      {
        stdio: 'inherit',
      },
    );

    if (result.error) throw result.error;
    exitCode = result.status ?? 0;
  }
} finally {
  await rm(sourceDir, { recursive: true, force: true });
}

process.exit(exitCode);
