import test from "node:test";
import assert from "node:assert/strict";
import { lastTrackedStatus, reportLastTracked } from "../src/lib/last-tracked.js";

const novel = {
  title: "  Mother of Learning ",
  lastReadChapterLabel: "2. Life Goes On",
  lastReadChapterUrl: "https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301780/2"
};

test("the status carries what the app shows and nothing else", () => {
  const status = lastTrackedStatus(novel, "auto", new Date("2026-09-30T10:00:00Z"));
  assert.deepEqual(status, {
    title: "Mother of Learning",
    chapterLabel: "2. Life Goes On",
    chapterUrl: novel.lastReadChapterUrl,
    source: "auto",
    at: "2026-09-30T10:00:00.000Z"
  });
});

test("anything but an automatic update counts as a manual save", () => {
  assert.equal(lastTrackedStatus(novel, "popup").source, "manual");
  assert.equal(lastTrackedStatus(novel, undefined).source, "manual");
});

test("long text is trimmed to the native handler's limits", () => {
  const status = lastTrackedStatus({ ...novel, title: "x".repeat(500), lastReadChapterLabel: "y".repeat(500) }, "manual");
  assert.equal(status.title.length, 300);
  assert.equal(status.chapterLabel.length, 300);
});

test("a novel without a web chapter URL is not reported", () => {
  assert.equal(lastTrackedStatus({ ...novel, lastReadChapterUrl: "javascript:alert(1)" }, "manual"), null);
  assert.equal(lastTrackedStatus({ ...novel, lastReadChapterUrl: `https://a.test/${"p".repeat(2100)}` }, "manual"), null);
  assert.equal(lastTrackedStatus(null, "manual"), null);
});

test("Safari hands the status to the app", async () => {
  const sent = [];
  const api = { runtime: { sendNativeMessage: async (_app, message) => { sent.push(message); return { stored: true }; } } };
  assert.equal(await reportLastTracked(novel, "auto", api), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "novel-tracker.status.store");
  assert.equal(sent[0].status.title, "Mother of Learning");
});

test("browsers without a containing app are left alone", async () => {
  let called = false;
  const chrome = { identity: {}, runtime: { sendNativeMessage: async () => { called = true; } } };
  assert.equal(await reportLastTracked(novel, "auto", chrome), false);
  assert.equal(await reportLastTracked(novel, "auto", { runtime: {} }), false);
  assert.equal(called, false);
});

test("a failed report never throws into the save", async () => {
  const api = { runtime: { sendNativeMessage: async () => { throw new Error("app not reachable"); } } };
  assert.equal(await reportLastTracked(novel, "manual", api), false);
  const refused = { runtime: { sendNativeMessage: async () => ({ error: "invalid" }) } };
  assert.equal(await reportLastTracked(novel, "manual", refused), false);
});
