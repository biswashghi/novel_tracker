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

test("Safari adapter uses native OAuth and shared session messages", async () => {
  const messages = [];
  const platform = getAuthPlatform({
    runtime: {
      sendNativeMessage(_app, message, callback) {
        messages.push(message);
        callback(message.type === "novel-tracker.oauth.authorize"
          ? { callbackUrl: "noveltracker://oauth/callback?code=ok" }
          : message.type === "novel-tracker.auth.get" ? { session: { accessToken: "token" } } : {});
      }
    }
  });
  assert.equal(platform.kind, "safari-native");
  assert.equal(await platform.authorize("https://auth.test"), "noveltracker://oauth/callback?code=ok");
  assert.deepEqual(await platform.sharedSession(), { accessToken: "token" });
  await platform.storeSharedSession({ accessToken: "next" });
  await platform.clearSharedSession();
  assert.deepEqual(messages.map(({ type }) => type), [
    "novel-tracker.oauth.authorize", "novel-tracker.auth.get", "novel-tracker.auth.store", "novel-tracker.auth.clear"
  ]);
});
