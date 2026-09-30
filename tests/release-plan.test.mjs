import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_NOTES, loadReleasePlan, previousReleaseTag, shouldUploadScreenshots } from "../scripts/release-plan.mjs";

function workspace(files = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "release-plan-"));
  for (const [file, contents] of Object.entries(files)) {
    const full = path.join(base, "docs/release/notes/1.2.0", file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return base;
}

const complete = {
  "app-store-ios.txt": "iPhone notes\n",
  "app-store-mac.txt": "Mac notes",
  "firefox.txt": "Firefox notes"
};

test("by default a version is submitted for App Review with its notes", () => {
  const plan = loadReleasePlan("1.2.0", workspace(complete));
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.apple, "app-store");
  assert.equal(plan.screenshots, "changed");
  assert.equal(plan.notes.ios, "iPhone notes");
  assert.equal(plan.notes.chrome, "");
  assert.match(plan.notePaths.mac, /app-store-mac\.txt$/);
});

test("an App Store release without notes is refused, naming every missing file", () => {
  const plan = loadReleasePlan("1.2.0", workspace({ "firefox.txt": "x" }));
  assert.equal(plan.errors.length, 2);
  assert.match(plan.errors[0], /app-store-ios\.txt is missing/);
  assert.match(plan.errors[1], /app-store-mac\.txt is missing/);
});

test("a TestFlight-only version doesn't need App Store notes, but Firefox still does", () => {
  const testflight = workspace({ "release.json": JSON.stringify({ apple: "testflight" }), "firefox.txt": "x" });
  assert.deepEqual(loadReleasePlan("1.2.0", testflight).errors, []);
  assert.equal(loadReleasePlan("1.2.0", testflight).apple, "testflight");

  const noFirefox = workspace({ "release.json": JSON.stringify({ apple: "testflight" }) });
  assert.match(loadReleasePlan("1.2.0", noFirefox).errors.join(), /firefox\.txt is missing/);
});

test("notes over the App Store's limit are refused", () => {
  const plan = loadReleasePlan("1.2.0", workspace({ ...complete, "app-store-ios.txt": "x".repeat(MAX_NOTES + 1) }));
  assert.match(plan.errors.join(), /4001 characters/);
});

test("release.json is validated", () => {
  const bad = (config) => loadReleasePlan("1.2.0", workspace({ ...complete, "release.json": config })).errors.join();
  assert.match(bad("{ not json"), /not valid JSON/);
  assert.match(bad(JSON.stringify({ apple: "beta" })), /"apple" must be one of/);
  assert.match(bad(JSON.stringify({ chrome: "auto" })), /unknown keys: chrome/);
  assert.match(bad(JSON.stringify({ screenshots: "yes" })), /"screenshots" must be true or false/);
});

test("with no notes directory at all, every required file is reported", () => {
  const plan = loadReleasePlan("9.9.9", workspace());
  assert.equal(plan.errors.length, 3);
});

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "release-plan-git-"));
  const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir });
  git("init", "-q");
  const shot = (name, contents) => {
    const full = path.join(dir, "store-assets/app-store/macos", name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  return { dir, git, shot, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("screenshots are replaced only when they changed since the previous release", () => {
  const r = repo();
  try {
    r.shot("01.jpg", "a");
    r.commit("first");
    const plan = { version: "1.2.0", screenshots: "changed" };
    assert.equal(shouldUploadScreenshots(plan, "mac", r.dir), true, "no earlier release to compare with");

    r.git("tag", "v1.1.0");
    writeFileSync(path.join(r.dir, "README"), "unrelated");
    r.commit("unrelated");
    assert.equal(previousReleaseTag("1.2.0", r.dir), "v1.1.0");
    assert.equal(shouldUploadScreenshots(plan, "mac", r.dir), false);
    assert.equal(shouldUploadScreenshots(plan, "firefox", r.dir), false);

    r.shot("01.jpg", "b");
    r.commit("new shot");
    assert.equal(shouldUploadScreenshots(plan, "mac", r.dir), true);
    assert.equal(shouldUploadScreenshots(plan, "ios", r.dir), false, "only the Mac set changed");

    // The version's own tag (a re-run of its release) isn't "previous".
    r.git("tag", "v1.2.0");
    assert.equal(previousReleaseTag("1.2.0", r.dir), "v1.1.0");
  } finally {
    r.cleanup();
  }
});

test("release.json can force screenshots on or off", () => {
  assert.equal(shouldUploadScreenshots({ version: "1.2.0", screenshots: true }, "mac"), true);
  assert.equal(shouldUploadScreenshots({ version: "1.2.0", screenshots: false }, "mac"), false);
});
