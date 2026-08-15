import test from "node:test";
import assert from "node:assert/strict";
import {
  getAuthPlatform,
  SAFARI_NATIVE_APP_ID,
  SAFARI_OAUTH_REDIRECT_URI
} from "../src/lib/auth-platform.js";

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

test("Safari adapter delegates only interactive authorization to native messaging", async () => {
  let nativeCall;
  const platform = getAuthPlatform({
    runtime: {
      sendNativeMessage(applicationId, message) {
        nativeCall = { applicationId, message };
        return Promise.resolve({ callbackUrl: `${SAFARI_OAUTH_REDIRECT_URI}?code=ok` });
      }
    }
  });
  assert.equal(platform.kind, "safari-native");
  assert.equal(platform.redirectUri("oauth2"), SAFARI_OAUTH_REDIRECT_URI);
  assert.equal(await platform.authorize("https://auth.test"), `${SAFARI_OAUTH_REDIRECT_URI}?code=ok`);
  assert.equal(nativeCall.applicationId, SAFARI_NATIVE_APP_ID);
  assert.equal(nativeCall.message.authorizationUrl, "https://auth.test");
});

test("Safari adapter supports callback-only native messaging", async () => {
  const platform = getAuthPlatform({
    runtime: {
      sendNativeMessage(_applicationId, message, callback) {
        callback({ callbackUrl: `${SAFARI_OAUTH_REDIRECT_URI}?code=callback` });
      }
    }
  });

  assert.equal(
    await platform.authorize("https://auth.test"),
    `${SAFARI_OAUTH_REDIRECT_URI}?code=callback`
  );
});
