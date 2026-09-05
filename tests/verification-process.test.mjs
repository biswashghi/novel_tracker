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

test("store workflows validate packages and exercise the exact Chrome ZIP", () => {
  for (const workflow of [pullRequestWorkflow, releaseWorkflow]) {
    assert.match(workflow, /validate-extension-package\.mjs/);
    assert.match(workflow, /NOVEL_EXTENSION_DIR=.*test:e2e:package/);
  }
});

test("the aggregate PR gate scans and exercises the exact API candidate", () => {
  assert.match(pullRequestWorkflow, /name: API image and vulnerability scan/);
  assert.match(pullRequestWorkflow, /uses: aquasecurity\/trivy-action@[a-f0-9]{40}/);
  assert.match(pullRequestWorkflow, /STAGING_NO_BUILD: "1"/);
  assert.match(pullRequestWorkflow, /needs:\s*\[test, build-api, integration,/);
});

test("production reuses the main image digest only after persistent staging", () => {
  assert.match(deploymentWorkflow, /Resolve the previously built main candidate/);
  assert.match(deploymentWorkflow, /environment: staging/);
  assert.match(deploymentWorkflow, /needs: \[build-candidate, docker-staging, staging\]/);
  assert.doesNotMatch(deploymentWorkflow, /push:\s*true/);
});

test("release promotion binds the API and restores Safari only from the verified ZIP", () => {
  assert.match(releaseWorkflow, /NOVEL_API_IMAGE=\$api_image/);
  assert.match(releaseWorkflow, /unzip -q "\$SAFARI_ZIP" -d build\/safari-xcode/);
  assert.doesNotMatch(releaseWorkflow, /name: safari-xcode-project/);
  assert.doesNotMatch(firefoxPublisher, /\bnpx\b/);
  assert.match(firefoxPublisher, /'npm',[\s\S]*'exec',[\s\S]*'web-ext'/);
});
