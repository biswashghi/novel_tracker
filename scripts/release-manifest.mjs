#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadMigrations } from '../server/migrations.js';

const [mode, manifestArgument, ...artifactArguments] = process.argv.slice(2);

if (!['create', 'verify'].includes(mode) || !manifestArgument) {
  throw new Error(
    'Usage: release-manifest.mjs create <manifest.json> <chrome.zip> <firefox.zip> <safari.zip>\n' +
      '   or: release-manifest.mjs verify <manifest.json>',
  );
}

const manifestPath = path.resolve(manifestArgument);
const manifestDirectory = path.dirname(manifestPath);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const expectedCommit =
  process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expectedAppleBuild = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim());
const currentMigration = (await loadMigrations()).at(-1);

async function describeArtifact(artifactArgument) {
  const artifactPath = path.resolve(artifactArgument);
  const contents = await readFile(artifactPath);
  const metadata = await stat(artifactPath);
  const filename = path.basename(artifactPath);

  let platform = 'chrome';
  if (filename.includes('-firefox-')) platform = 'firefox';
  if (filename.includes('-safari-xcode-')) platform = 'safari';

  return {
    platform,
    path: path.relative(manifestDirectory, artifactPath).split(path.sep).join('/'),
    sha256: createHash('sha256').update(contents).digest('hex'),
    bytes: metadata.size,
  };
}

function validateShape(manifest) {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported release manifest schema.');
  if (manifest.version !== packageJson.version) {
    throw new Error(`Manifest version ${manifest.version} does not match package.json ${packageJson.version}.`);
  }
  if (manifest.commit !== expectedCommit) {
    throw new Error(`Manifest commit ${manifest.commit} does not match checked-out commit ${expectedCommit}.`);
  }
  if (!/^ghcr\.io\/[a-z0-9._/-]+\/novel-tracker-api@sha256:[a-f0-9]{64}$/.test(manifest.apiImage || '')) {
    throw new Error('Release manifest must bind an immutable Novel Tracker API image.');
  }
  if (manifest.appleBuildNumber !== expectedAppleBuild) {
    throw new Error(`Manifest Apple build ${manifest.appleBuildNumber} does not match ${expectedAppleBuild}.`);
  }
  if (
    manifest.schemaMigration?.version !== currentMigration.version ||
    manifest.schemaMigration?.sha256 !== currentMigration.checksum
  ) {
    throw new Error('Manifest schema migration does not match the checked-out source.');
  }
  if (!manifest.toolchains?.node || manifest.toolchains.packageLockVersion !== packageLock.lockfileVersion) {
    throw new Error('Release manifest is missing toolchain identity.');
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 3) {
    throw new Error('Release manifest must contain exactly three store artifacts.');
  }

  const platforms = manifest.artifacts.map(({ platform }) => platform).sort();
  if (platforms.join(',') !== 'chrome,firefox,safari') {
    throw new Error('Release manifest must contain one artifact for Chrome, Firefox, and Safari.');
  }

  const expectedSuffixes = {
    chrome: `-${packageJson.version}.zip`,
    firefox: `-firefox-${packageJson.version}.zip`,
    safari: `-safari-xcode-${packageJson.version}.zip`,
  };
  for (const artifact of manifest.artifacts) {
    if (!artifact.path.endsWith(expectedSuffixes[artifact.platform])) {
      throw new Error(`${artifact.platform} package filename does not contain release version ${packageJson.version}.`);
    }
  }
}

if (mode === 'create') {
  if (artifactArguments.length !== 3) {
    throw new Error('Exactly three release ZIP paths are required.');
  }

  const artifacts = await Promise.all(artifactArguments.map(describeArtifact));
  const manifest = {
    schemaVersion: 1,
    version: packageJson.version,
    commit: expectedCommit,
    apiImage: process.env.NOVEL_API_IMAGE || '',
    appleBuildNumber: expectedAppleBuild,
    schemaMigration: {
      version: currentMigration.version,
      sha256: currentMigration.checksum,
    },
    toolchains: {
      node: process.version,
      packageLockVersion: packageLock.lockfileVersion,
    },
    ciRun: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : 'local',
    createdAt: new Date().toISOString(),
    artifacts: artifacts.sort((left, right) => left.platform.localeCompare(right.platform)),
  };
  validateShape(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created release manifest at ${manifestPath}`);
} else {
  if (artifactArguments.length !== 0) throw new Error('Verify accepts only a manifest path.');

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateShape(manifest);

  for (const expected of manifest.artifacts) {
    const actual = await describeArtifact(path.resolve(manifestDirectory, expected.path));
    if (
      actual.platform !== expected.platform ||
      actual.sha256 !== expected.sha256 ||
      actual.bytes !== expected.bytes
    ) {
      throw new Error(`Release artifact verification failed for ${expected.platform}.`);
    }
  }

  console.log(`Verified release ${manifest.version} from ${manifest.commit}.`);
}
