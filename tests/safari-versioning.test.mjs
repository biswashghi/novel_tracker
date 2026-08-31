import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Safari packaging refuses shallow history before building or modifying artifacts', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'novel-tracker-version-test-'));
  try {
    const source = path.join(directory, 'source');
    const checkout = path.join(directory, 'shallow');
    mkdirSync(path.join(source, 'scripts'), { recursive: true });
    writeFileSync(path.join(source, 'scripts/package-safari.sh'), readFileSync(path.join(root, 'scripts/package-safari.sh')));
    const git = (...args) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
    git('init');
    git('add', 'scripts/package-safari.sh');
    const commitOptions = ['-c', 'user.name=Version Test', '-c', 'user.email=version-test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
    git(...commitOptions, 'commit', '-m', 'fixture');
    git(...commitOptions, 'commit', '--allow-empty', '-m', 'second fixture commit');
    execFileSync('git', ['clone', '--depth', '1', pathToFileURL(source).href, checkout], { stdio: 'pipe' });

    const result = spawnSync('bash', [path.join(checkout, 'scripts/package-safari.sh')], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires full Git history/);
    assert.doesNotMatch(result.stdout, /Building Safari extension/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Safari CI packaging checks out full history for both releases and PRs', () => {
  for (const workflow of ['release.yml', 'pr.yml']) {
    const source = readFileSync(path.join(root, '.github/workflows', workflow), 'utf8');
    const safariJob = source.split(/^  build-safari:\s*$/m)[1]?.split(/^  [\w-]+:\s*$/m)[0];
    assert.match(safariJob ?? '', /uses: actions\/checkout@[^\n]+\n\s+with:\s*\n(?:\s+#[^\n]*\n)*\s+fetch-depth: 0/, workflow);
  }
});
