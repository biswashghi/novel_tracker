import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
let nextSubject = "google-user-1";
let authorizeUrl = "";
// Empty means "realm has no provider mapper", which is the local/e2e case and
// exercises the fallback to the requested provider id.
let nextProviderClaim = "";

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
      access_token: jwt({
        sub: nextSubject,
        email: `${nextSubject}@example.test`,
        name: "Reader",
        ...(nextProviderClaim ? { provider: nextProviderClaim } : {})
      }),
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

test("concurrent expired-token calls share a single refresh exchange", async () => {
  store.clear();
  nextSubject = "google-user-3";
  await auth.signIn({ hasLocalData: false });

  let exchangeCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = String(options?.body || "");
    if (body.includes("grant_type=refresh_token")) {
      exchangeCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return originalFetch(url, options);
  };

  try {
    // Force the recorded token to look expired so getAccessToken refreshes.
    const stored = store.get("novel-tracker:auth");
    stored.active.expiresAt = Date.now() - 1000;
    store.set("novel-tracker:auth", stored);

    const [first, second, third] = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken()
    ]);

    assert.equal(exchangeCount, 1);
    assert.equal(first, second);
    assert.equal(second, third);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an unrefreshable expired session is cleared instead of handed out", async () => {
  store.clear();
  nextSubject = "google-user-4";
  await auth.signIn({ hasLocalData: false });
  const stored = store.get("novel-tracker:auth");
  stored.active.expiresAt = Date.now() - 1000;
  delete stored.active.refreshToken;
  store.set("novel-tracker:auth", stored);

  assert.equal(await auth.getAccessToken(), "");
  assert.equal(store.get("novel-tracker:auth").active, null);
});

// Sign in with Apple is required by App Store guideline 4.8. It is brokered
// through Keycloak so both providers share this one flow, differing only by
// `kc_idp_hint` — which is what these tests pin down.

test("Apple sign-in reuses the Google flow and only swaps the provider hint", async () => {
  store.clear();
  nextSubject = "apple-user-1";
  nextProviderClaim = "";

  const account = await auth.signIn({ provider: "apple", hasLocalData: false });
  const query = new URL(authorizeUrl).searchParams;

  assert.equal(query.get("kc_idp_hint"), "apple");
  // Same PKCE flow as Google: nothing Apple-specific in the request itself.
  assert.equal(query.get("response_type"), "code");
  assert.equal(query.get("code_challenge_method"), "S256");
  assert.equal(account.signedIn, true);
  // No mapper in this realm, so the requested provider is what gets recorded.
  assert.equal(account.provider, "apple");
});

test("the realm's provider claim outranks the button that was tapped", async () => {
  store.clear();
  nextSubject = "apple-user-2";
  nextProviderClaim = "apple";

  try {
    const account = await auth.signIn({ provider: "google", hasLocalData: false });
    assert.equal(account.provider, "apple");
  } finally {
    nextProviderClaim = "";
  }
});

test("the provider survives a token refresh", async () => {
  store.clear();
  nextSubject = "apple-user-3";
  await auth.signIn({ provider: "apple", hasLocalData: false });

  const stored = store.get("novel-tracker:auth");
  stored.active.expiresAt = Date.now() - 1000;
  store.set("novel-tracker:auth", stored);

  await auth.getAccessToken();
  // Refresh responses carry no provider claim here, so this is the `previous`
  // fallback in tokenRecord doing its job. Losing it would silently downgrade
  // an Apple account to Google and skip Apple's required token revocation on
  // deletion.
  assert.equal(store.get("novel-tracker:auth").active.provider, "apple");
});

test("switching providers is held pending and names the provider", async () => {
  store.clear();
  nextSubject = "google-user-5";
  await auth.signIn({ provider: "google", hasLocalData: false });
  await auth.signOut();

  nextSubject = "apple-user-4";
  const pending = await auth.signIn({ provider: "apple", hasLocalData: true });

  assert.equal(pending.needsAccountConfirmation, true);
  assert.equal(pending.pendingProvider, "apple");
});

test("an unknown provider is refused before any browser window opens", async () => {
  store.clear();
  await assert.rejects(
    () => auth.signIn({ provider: "facebook", hasLocalData: false }),
    /Unknown sign-in provider: facebook/
  );
});
