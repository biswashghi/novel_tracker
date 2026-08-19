import test from "node:test";
import assert from "node:assert/strict";
import { platformFetch } from "../src/lib/platform-http.js";

test("Safari HTTP transport delegates requests to the native extension", async () => {
  const previousBrowser = globalThis.browser;
  let sent;
  globalThis.browser = {
    runtime: {
      sendNativeMessage(applicationId, message, callback) {
        sent = { applicationId, message };
        callback({ status: 200, body: '{"ok":true}' });
      }
    }
  };
  try {
    const response = await platformFetch("https://api.novel.bghimire.com/v1/sync", {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: '{"mutations":[]}'
    });
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(sent.applicationId, "app.noveltracker.extension");
    assert.equal(sent.message.type, "novel-tracker.http.request");
    assert.equal(sent.message.method, "POST");
    assert.equal(sent.message.headers.authorization, "Bearer token");
  } finally {
    globalThis.browser = previousBrowser;
  }
});

test("Chrome and Firefox use the normal fetch path when native Safari messaging is unavailable", async () => {
  const previousBrowser = globalThis.browser;
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.browser = { storage: {} };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() { return "OK"; },
      async json() { return { ok: true }; }
    };
  };

  try {
    const response = await platformFetch("https://api.example.test/health", { method: "GET" });
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.test/health");
  } finally {
    globalThis.browser = previousBrowser;
    globalThis.fetch = previousFetch;
  }
});

test("Safari HTTP transport surfaces native message failures", async () => {
  const previousBrowser = globalThis.browser;
  globalThis.browser = {
    runtime: {
      sendNativeMessage(_appId, _message, callback) {
        callback({ status: 500, body: '"bad gateway"' });
      }
    }
  };

  try {
    const response = await platformFetch("https://api.example.test/fail", { method: "GET" });
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
    assert.equal(await response.text(), '"bad gateway"');
  } finally {
    globalThis.browser = previousBrowser;
  }
});
