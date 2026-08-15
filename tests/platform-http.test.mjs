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
    assert.equal(sent.message.type, "novel-tracker.http.request");
    assert.equal(sent.message.method, "POST");
    assert.equal(sent.message.headers.authorization, "Bearer token");
  } finally {
    globalThis.browser = previousBrowser;
  }
});
