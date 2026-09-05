import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts/release-manifest.mjs');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const apiImage = `ghcr.io/example/novel-tracker-api@sha256:${'a'.repeat(64)}`;

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'novel-release-manifest-'));
  const artifactDirectory = path.join(directory, 'artifacts');
  await mkdir(artifactDirectory);

  const artifacts = [
    path.join(artifactDirectory, `novel-tracker-extension-${version}.zip`),
    path.join(artifactDirectory, `novel-tracker-extension-firefox-${version}.zip`),
    path.join(artifactDirectory, `novel-tracker-safari-xcode-${version}.zip`),
  ];
  await Promise.all(artifacts.map((file, index) => writeFile(file, `artifact-${index}`)));

  return { artifacts, manifest: path.join(directory, 'release-manifest.json') };
}

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_SHA: commit, NOVEL_API_IMAGE: apiImage },
  });
}

test('release manifest binds all store packages to one version and commit', async () => {
  const { artifacts, manifest } = await fixture();
  const created = run(['create', manifest, ...artifacts]);
  assert.equal(created.status, 0, created.stderr);

  const contents = JSON.parse(await readFile(manifest, 'utf8'));
  assert.equal(contents.commit, commit);
  assert.equal(contents.apiImage, apiImage);
  assert.ok(Number.isInteger(contents.appleBuildNumber));
  assert.match(contents.schemaMigration.version, /^\d{4}_/);
  assert.deepEqual(
    contents.artifacts.map(({ platform }) => platform),
    ['chrome', 'firefox', 'safari'],
  );

  const verified = run(['verify', manifest]);
  assert.equal(verified.status, 0, verified.stderr);
});

test('release manifest verification rejects a changed package', async () => {
  const { artifacts, manifest } = await fixture();
  assert.equal(run(['create', manifest, ...artifacts]).status, 0);
  await writeFile(artifacts[0], 'tampered');

  const verified = run(['verify', manifest]);
  assert.notEqual(verified.status, 0);
  assert.match(verified.stderr, /verification failed for chrome/);
});
