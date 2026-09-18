import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [stackScript, makefile] = await Promise.all([
  readFile(new URL("../scripts/e2e-stack.mjs", import.meta.url), "utf8"),
  readFile(new URL("../Makefile", import.meta.url), "utf8")
]);
const [pullRequestWorkflow, releaseWorkflow, deploymentWorkflow, firefoxPublisher] = await Promise.all([
  readFile(new URL("../.github/workflows/pr.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/publish-firefox.mjs", import.meta.url), "utf8")
]);

test("local e2e stack always rebuilds the source-backed API image", () => {
  assert.match(stackScript, /composeArgs, "up", "-d", "--build", "--wait"/);
});

test("ephemeral staging rebuilds by default and only reuses an explicit candidate", () => {
  assert.match(makefile, /build_flag=--build/);
  assert.match(makefile, /STAGING_NO_BUILD/);
  assert.match(makefile, /build_flag=--no-build/);
});

test("store workflows validate packages and the PR gate exercises the exact Chrome ZIP", () => {
  for (const workflow of [pullRequestWorkflow, releaseWorkflow]) {
    assert.match(workflow, /validate-extension-package\.mjs/);
  }
  assert.match(pullRequestWorkflow, /make package-test PACKAGE=.*find candidate\/chrome/);
  assert.match(makefile, /NOVEL_EXTENSION_DIR=.*test:e2e:package/);
});

test("the aggregate PR gate scans and exercises the exact API candidate", () => {
  assert.match(pullRequestWorkflow, /name: API image and vulnerability scan/);
  assert.match(pullRequestWorkflow, /uses: aquasecurity\/trivy-action@[a-f0-9]{40}/);
  assert.match(pullRequestWorkflow, /STAGING_NO_BUILD: "1"/);
  assert.match(pullRequestWorkflow, /needs:\s*\[test, build-api, integration,/);
});

test("the API deploys only the digest that main already built and regression-tested", () => {
  assert.match(deploymentWorkflow, /make api-test/);
  assert.match(deploymentWorkflow, /Require a passing build for this commit/);
  assert.match(deploymentWorkflow, /environment: production/);
  assert.match(deploymentWorkflow, /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(deploymentWorkflow, /release-manifest|NOVEL_TRACKER_SAFARI/);
  assert.match(makefile, /api-test: STAGING_E2E = 0/);
});

test("store publishing is approved once, verifies the bound candidate, and tags last", () => {
  assert.match(releaseWorkflow, /git ls-remote --exit-code --tags origin "refs\/tags\/v\$\{version\}"/);
  assert.match(releaseWorkflow, /environment: production/);
  assert.equal(releaseWorkflow.match(/environment: production/g).length, 1);
  // Every job that verifies the manifest needs full history for the Apple
  // build number; a shallow checkout counts one commit and fails the verify.
  const verifyingJobs = releaseWorkflow.split(/\n  [a-z-]+:\n/).filter((job) => job.includes("release-manifest.mjs verify"));
  assert.equal(verifyingJobs.length, 4);
  for (const job of verifyingJobs) assert.match(job, /fetch-depth: 0/);
  assert.match(releaseWorkflow, /needs: \[version, publish-chrome, publish-firefox, publish-safari\]/);
  assert.match(releaseWorkflow, /unzip -q release-candidate\/safari\/\*\.zip -d build\/safari-xcode/);
  assert.doesNotMatch(releaseWorkflow, /RELEASES_ENABLED|NOVEL_API_IMAGE|workflow_dispatch/);
  assert.doesNotMatch(firefoxPublisher, /\bnpx\b/);
  assert.match(firefoxPublisher, /'npm',[\s\S]*'exec',[\s\S]*'web-ext'/);
});
