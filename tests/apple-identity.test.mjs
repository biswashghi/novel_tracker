import test from "node:test";
import assert from "node:assert/strict";
import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair } from "jose";

import {
  APPLE_MAX_SECRET_LIFETIME_SECONDS,
  createAppleClientSecret,
  readAppleConfig
} from "../server/apple-client-secret.js";
import {
  deleteIdentityUser,
  readBrokerToken,
  readIdentityAdminConfig,
  revokeAppleToken
} from "../server/identity-admin.js";

const { privateKey } = await generateKeyPair("ES256");
const PEM = await exportPKCS8(privateKey);

function appleEnv(overrides = {}) {
  return {
    APPLE_TEAM_ID: "3LQK7JJTX2",
    APPLE_SERVICES_ID: "app.noveltracker.signin",
    APPLE_KEY_ID: "ABC123XYZ9",
    APPLE_PRIVATE_KEY: PEM,
    ...overrides
  };
}

/** Swaps global fetch for the duration of one call, recording what it saw. */
async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options);
  };
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

function response(status, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body; },
    async json() { return JSON.parse(body); }
  };
}

test("PEM newlines flattened by env files and CI secrets are restored", () => {
  const escaped = readAppleConfig(appleEnv({ APPLE_PRIVATE_KEY: PEM.replace(/\n/g, "\\n") }));
  assert.equal(escaped.configured, true);
  assert.equal(escaped.privateKey, PEM.trim());
});

test("missing Apple credentials read as unconfigured rather than half-configured", () => {
  assert.equal(readAppleConfig(appleEnv({ APPLE_KEY_ID: "" })).configured, false);
  assert.equal(readAppleConfig({}).configured, false);
});

test("the Apple client secret is an ES256 JWT with Apple's required claims", async () => {
  const jwt = await createAppleClientSecret(readAppleConfig(appleEnv()));
  const header = decodeProtectedHeader(jwt);
  const claims = decodeJwt(jwt);

  assert.equal(header.alg, "ES256");
  assert.equal(header.kid, "ABC123XYZ9");
  assert.equal(claims.iss, "3LQK7JJTX2");
  // `sub` must be the Services ID, never the app's bundle identifier.
  assert.equal(claims.sub, "app.noveltracker.signin");
  assert.equal(claims.aud, "https://appleid.apple.com");
});

test("the secret lifetime cannot exceed Apple's six-month ceiling", async () => {
  const config = readAppleConfig(appleEnv());
  await assert.rejects(
    () => createAppleClientSecret(config, APPLE_MAX_SECRET_LIFETIME_SECONDS + 1),
    /lifetime must be between/
  );
  const jwt = await createAppleClientSecret(config, APPLE_MAX_SECRET_LIFETIME_SECONDS);
  const claims = decodeJwt(jwt);
  assert.ok(claims.exp - claims.iat <= APPLE_MAX_SECRET_LIFETIME_SECONDS);
});

test("revoking posts Apple's four required parameters", async () => {
  const config = readAppleConfig(appleEnv());
  const { result, calls } = await withFetch(
    () => response(200),
    () => revokeAppleToken(config, "apple-refresh-token")
  );

  assert.deepEqual(result, { revoked: true });
  assert.equal(calls[0].url, "https://appleid.apple.com/auth/revoke");
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get("client_id"), "app.noveltracker.signin");
  assert.equal(body.get("token"), "apple-refresh-token");
  assert.equal(body.get("token_type_hint"), "refresh_token");
  assert.ok(body.get("client_secret"), "a freshly signed client secret is sent");
});

test("a token Apple already rejects counts as revoked, not as a failure", async () => {
  // The goal is that the grant no longer exists — and it doesn't. Throwing here
  // would block the reader from ever completing account deletion.
  const { result } = await withFetch(
    () => response(400, '{"error":"invalid_grant"}'),
    () => revokeAppleToken(readAppleConfig(appleEnv()), "stale-token")
  );
  assert.deepEqual(result, { revoked: false, reason: "already-invalid" });
});

test("a misconfigured Apple client fails loudly instead of silently skipping", async () => {
  // invalid_client means our own credentials are wrong; swallowing it would
  // leave Novel Tracker listed under the reader's Apple ID after deletion.
  await withFetch(
    () => response(400, '{"error":"invalid_client"}'),
    () => assert.rejects(
      () => revokeAppleToken(readAppleConfig(appleEnv()), "some-token"),
      /Apple token revocation failed \(400\)/
    )
  );
});

test("no stored Apple token means there is nothing to revoke", async () => {
  const { result, calls } = await withFetch(
    () => response(200),
    () => revokeAppleToken(readAppleConfig(appleEnv()), null)
  );
  assert.deepEqual(result, { revoked: false, reason: "no-token" });
  assert.equal(calls.length, 0, "Apple is not called at all");
});

test("admin config is derived from the issuer and overridable for internal routing", () => {
  const base = {
    KEYCLOAK_ISSUER: "https://auth.novel.bghimire.com/realms/novel-tracker",
    KEYCLOAK_ADMIN_CLIENT_ID: "novel-tracker-admin",
    KEYCLOAK_ADMIN_CLIENT_SECRET: "secret"
  };

  const derived = readIdentityAdminConfig(base);
  assert.equal(derived.baseUrl, "https://auth.novel.bghimire.com");
  assert.equal(derived.realm, "novel-tracker");
  assert.equal(derived.configured, true);

  // The issuer is the address the browser used, which the API container may not
  // be able to route to — same reason KEYCLOAK_JWKS_URL exists.
  const overridden = readIdentityAdminConfig({ ...base, KEYCLOAK_ADMIN_URL: "http://keycloak:8080" });
  assert.equal(overridden.baseUrl, "http://keycloak:8080");
  assert.equal(overridden.realm, "novel-tracker");

  assert.equal(readIdentityAdminConfig({ ...base, KEYCLOAK_ADMIN_CLIENT_SECRET: "" }).configured, false);
});

test("an unfederated account reports no broker token instead of erroring", async () => {
  const config = readIdentityAdminConfig({
    KEYCLOAK_ISSUER: "https://auth.example.test/realms/novel-tracker",
    KEYCLOAK_ADMIN_CLIENT_ID: "id",
    KEYCLOAK_ADMIN_CLIENT_SECRET: "secret"
  });
  const { result } = await withFetch(
    () => response(404),
    () => readBrokerToken(config, "user-token", "apple")
  );
  assert.equal(result, null);
});

test("deleting an already-absent user is the desired end state, not an error", async () => {
  const config = readIdentityAdminConfig({
    KEYCLOAK_ISSUER: "https://auth.example.test/realms/novel-tracker",
    KEYCLOAK_ADMIN_CLIENT_ID: "id",
    KEYCLOAK_ADMIN_CLIENT_SECRET: "secret"
  });

  const { result, calls } = await withFetch(
    (url) => url.includes("/protocol/openid-connect/token")
      ? response(200, '{"access_token":"admin-token"}')
      : response(404),
    () => deleteIdentityUser(config, "missing-subject")
  );

  assert.deepEqual(result, { deleted: false, reason: "not-found" });
  const deleteCall = calls.at(-1);
  assert.equal(deleteCall.options.method, "DELETE");
  assert.ok(deleteCall.url.endsWith("/admin/realms/novel-tracker/users/missing-subject"));
});
