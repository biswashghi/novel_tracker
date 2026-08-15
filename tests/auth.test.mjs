import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
let nextSubject = "google-user-1";
let authorizeUrl = "";

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.`;
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
  identity: {
    getRedirectURL(path) {
      return `https://extension-id.chromiumapp.org/${path}`;
    },
    async launchWebAuthFlow({ url }) {
      authorizeUrl = url;
      const state = new URL(url).searchParams.get("state");
      return `https://extension-id.chromiumapp.org/oauth2?code=test-code&state=${state}`;
    }
  }
};

globalThis.fetch = async () => ({
  ok: true,
  async json() {
    return {
      access_token: jwt({ sub: nextSubject, email: `${nextSubject}@example.test`, name: "Reader" }),
      refresh_token: "refresh-token",
      expires_in: 300
    };
  },
  async text() { return ""; }
});

const auth = await import("../src/lib/auth.js");

test("Firefox uses Mozilla's stable loopback OAuth callback", () => {
  assert.equal(
    auth.oauthRedirectUri("https://firefox-addon-id.extensions.allizom.org/oauth2"),
    "http://127.0.0.1/mozoauth2/firefox-addon-id"
  );
});

test("Google sign-in uses authorization code PKCE and activates the first account", async () => {
  store.clear();
  nextSubject = "google-user-1";
  const account = await auth.signIn({ hasLocalData: true });
  const query = new URL(authorizeUrl).searchParams;
  assert.equal(query.get("response_type"), "code");
  assert.equal(query.get("code_challenge_method"), "S256");
  assert.equal(query.get("kc_idp_hint"), "google");
  assert.equal(account.signedIn, true);
  assert.equal(account.email, "google-user-1@example.test");
});

test("a different account is held pending until the customer confirms the merge", async () => {
  await auth.signOut();
  nextSubject = "google-user-2";
  const pending = await auth.signIn({ hasLocalData: true });
  assert.equal(pending.signedIn, false);
  assert.equal(pending.needsAccountConfirmation, true);
  assert.equal(pending.pendingEmail, "google-user-2@example.test");
  const confirmed = await auth.confirmPendingAccount();
  assert.equal(confirmed.signedIn, true);
  assert.equal(confirmed.subject, "google-user-2");
});
