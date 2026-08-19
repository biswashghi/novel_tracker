import test from "node:test";
import assert from "node:assert/strict";
import { getAuthPlatform } from "../src/lib/auth-platform.js";

test("web extension identity adapter is preferred when available", async () => {
  const calls = [];
  const platform = getAuthPlatform({
    identity: {
      getRedirectURL: (path) => `https://extension.test/${path}`,
      launchWebAuthFlow: async (options) => {
        calls.push(options);
        return "https://extension.test/oauth2?code=ok";
      }
    },
    runtime: { sendNativeMessage: async () => ({}) }
  });
  assert.equal(platform.kind, "web-extension-identity");
  assert.equal(platform.redirectUri("oauth2"), "https://extension.test/oauth2");
  assert.equal(await platform.authorize("https://auth.test"), "https://extension.test/oauth2?code=ok");
  assert.deepEqual(calls, [{ url: "https://auth.test", interactive: true }]);
});

test("Chrome and Firefox platform adapters reject unsupported browsers", () => {
  assert.throws(() => getAuthPlatform({}), /This browser does not provide an interactive authentication adapter/);
  assert.throws(() => getAuthPlatform({ identity: { getRedirectURL: () => "https://example.test/oauth2" } }), /This browser does not provide an interactive authentication adapter/);
});

test("Safari native adapter uses the correct native app ID and callback contract", async () => {
  const messages = [];
  const platform = getAuthPlatform({
    runtime: {
      sendNativeMessage(applicationId, message, callback) {
        messages.push({ applicationId, message });
        if (typeof callback === "function") {
          callback(message.type === "novel-tracker.oauth.authorize"
            ? { callbackUrl: "noveltracker://oauth/callback?code=ok" }
            : message.type === "novel-tracker.auth.get" ? { session: { accessToken: "token" } } : {});
        }
        return Promise.resolve(message.type === "novel-tracker.auth.get"
          ? { session: { accessToken: "token" } }
          : {});
      }
    }
  });

  assert.equal(platform.kind, "safari-native");
  assert.equal(messages.length, 0);
  assert.equal(await platform.authorize("https://auth.test"), "noveltracker://oauth/callback?code=ok");
  assert.deepEqual(await platform.sharedSession(), { accessToken: "token" });
  await platform.storeSharedSession({ accessToken: "next" });
  await platform.clearSharedSession();

  assert.deepEqual(messages.map(({ applicationId, message }) => ({ applicationId, type: message.type })), [
    { applicationId: "app.noveltracker.extension", type: "novel-tracker.oauth.authorize" },
    { applicationId: "app.noveltracker.extension", type: "novel-tracker.auth.get" },
    { applicationId: "app.noveltracker.extension", type: "novel-tracker.auth.store" },
    { applicationId: "app.noveltracker.extension", type: "novel-tracker.auth.clear" }
  ]);
});

test("Safari native adapter propagates native errors and rejects missing callback values", async () => {
  const platform = getAuthPlatform({
    runtime: {
      sendNativeMessage(_applicationId, message, callback) {
        if (typeof callback === "function") callback({ error: "bad auth" });
        return Promise.resolve({ error: "bad auth" });
      }
    }
  });

  await assert.rejects(() => platform.authorize("https://auth.test"), /bad auth/);
  await assert.rejects(() => platform.sharedSession(), /bad auth/);
});
