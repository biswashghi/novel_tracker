import test from "node:test";
import assert from "node:assert/strict";

// Safari has no identity API: sign-in, the shared keychain session and HTTP
// all go through native messaging to the containing app. This stands in
// for that bridge with an in-memory keychain.

const store = new Map();
let keychain = null;
let keychainError = null;
const nativeLog = [];
const logouts = [];
let refreshGate = null;
let issued = 0;

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.`;
}

function session(subject, overrides = {}) {
  return {
    accessToken: jwt({ sub: subject, email: `${subject}@example.test` }),
    refreshToken: `refresh-${subject}`,
    idToken: "",
    expiresAt: Date.now() + 10 * 60_000,
    subject,
    email: `${subject}@example.test`,
    name: "Reader",
    provider: "apple",
    ...overrides
  };
}

async function handleHttp(message) {
  const url = new URL(message.url);
  if (url.pathname.endsWith("/logout")) {
    logouts.push(new URLSearchParams(message.body).get("refresh_token"));
    return { status: 204, body: "" };
  }
  const form = new URLSearchParams(message.body);
  if (form.get("grant_type") === "refresh_token") await refreshGate?.promise;
  const subject = form.get("grant_type") === "refresh_token" ? form.get("refresh_token").replace(/^refresh-/, "") : "signed-in-here";
  return {
    status: 200,
    body: JSON.stringify({
      access_token: jwt({ sub: subject, email: `${subject}@example.test`, jti: `issued-${++issued}` }),
      refresh_token: `refresh-${subject}`,
      expires_in: 300
    })
  };
}

globalThis.browser = {
  storage: {
    local: {
      async get(key) {
        return { [key]: store.get(key) };
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) store.set(key, value);
      }
    }
  },
  runtime: {
    async sendNativeMessage(_applicationId, message) {
      nativeLog.push({ type: message.type, localSubject: store.get("novel-tracker:auth")?.active?.subject || "" });
      switch (message.type) {
        case "novel-tracker.auth.get":
          if (keychainError) return { error: keychainError };
          return { session: keychain };
        case "novel-tracker.auth.store":
          keychain = message.session;
          return { stored: true };
        case "novel-tracker.auth.clear":
          keychain = null;
          return { cleared: true };
        case "novel-tracker.oauth.authorize": {
          const state = new URL(message.authorizationUrl).searchParams.get("state");
          return { callbackUrl: `noveltracker://oauth/callback?code=abc&state=${state}` };
        }
        case "novel-tracker.http.request":
          return handleHttp(message);
        default:
          return { error: `unexpected ${message.type}` };
      }
    }
  }
};

const auth = await import("../src/lib/auth.js");

test.beforeEach(() => {
  store.clear();
  keychain = null;
  keychainError = null;
  nativeLog.length = 0;
  logouts.length = 0;
  refreshGate = null;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the extension adopts the session the app signed in with", async () => {
  keychain = session("apple-reader");
  const account = await auth.getAccountStatus();
  assert.equal(account.signedIn, true);
  assert.equal(account.subject, "apple-reader");
});

test("signing out in the app signs the extension out too", async () => {
  keychain = session("apple-reader");
  assert.equal((await auth.getAccountStatus()).signedIn, true);

  keychain = null; // The app's Sign Out clears the shared keychain item.

  const account = await auth.getAccountStatus();
  assert.equal(account.signedIn, false);
  assert.equal(await auth.getAccessToken(), "", "no token is handed to sync after the app signed out");
  await settle();
  assert.deepEqual(logouts, ["refresh-apple-reader"], "the server session behind our copy is ended too");
});

test("signing into a different account in the app switches the extension to it", async () => {
  keychain = session("first-reader");
  await auth.getAccountStatus();

  keychain = session("second-reader");
  const account = await auth.getAccountStatus();
  assert.equal(account.signedIn, true);
  assert.equal(account.subject, "second-reader");
  await settle();
  assert.deepEqual(logouts, ["refresh-first-reader"]);
});

test("a keychain that can't be read right now doesn't sign the reader out", async () => {
  keychain = session("apple-reader");
  await auth.getAccountStatus();

  keychainError = "errSecInteractionNotAllowed";
  assert.equal((await auth.getAccountStatus()).signedIn, true);
  assert.ok(await auth.getAccessToken());
});

test("with nothing to keep, a keychain error still surfaces", async () => {
  keychainError = "errSecInteractionNotAllowed";
  await assert.rejects(() => auth.getAccountStatus(), /errSecInteractionNotAllowed/);
});

test("a sign-in from the extension stores the shared session before its own copy", async () => {
  await auth.signIn({ provider: "apple" });

  const storeCall = nativeLog.find((entry) => entry.type === "novel-tracker.auth.store");
  assert.ok(storeCall, "the session reaches the keychain");
  assert.equal(storeCall.localSubject, "", "the keychain is written first");
  assert.equal(keychain.subject, "signed-in-here");
  assert.equal((await auth.getAccountStatus()).signedIn, true);
});

test("a token refresh that finishes after the app signed out doesn't sign the app back in", async () => {
  keychain = session("apple-reader", { expiresAt: Date.now() - 1000 });
  await auth.getAccountStatus();

  let release;
  refreshGate = { promise: new Promise((resolve) => { release = resolve; }) };
  const pending = auth.getAccessToken();
  await settle();

  keychain = null; // The app signs out while the refresh is in flight.
  release();

  assert.equal(await pending, "");
  assert.equal(keychain, null, "the keychain stays signed out");
  assert.equal((await auth.getAccountStatus()).signedIn, false);
});

test("an ordinary refresh keeps the app and the extension on the same tokens", async () => {
  keychain = session("apple-reader", { expiresAt: Date.now() - 1000 });
  await auth.getAccountStatus();

  const token = await auth.getAccessToken();
  assert.ok(token);
  assert.equal(keychain.accessToken, token, "the rotated tokens are written back for the app");
  assert.equal((await auth.getAccountStatus()).signedIn, true);
});

test("an expired session from the keychain is refreshed, not treated as fresh", async () => {
  keychain = session("apple-reader", { expiresAt: Date.now() - 1000 });
  const before = keychain.accessToken;
  const token = await auth.getAccessToken();
  assert.ok(token);
  assert.ok(nativeLog.some((entry) => entry.type === "novel-tracker.http.request"), "a refresh exchange ran");
  assert.equal(keychain.accessToken, token);
  assert.equal(before === token, false, "the stale access token isn't handed out");
});
