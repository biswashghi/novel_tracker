// Identity-side half of account deletion.
//
// `DELETE /v1/account` used to drop sync rows and stop there, which left the
// Keycloak user — and therefore the account — alive. App Store guideline
// 5.1.1(v) requires the account itself to go, and Apple additionally requires
// that a Sign in with Apple token be revoked when the account is deleted.
// Both of those are identity-provider operations rather than database ones,
// so they live here.
import { APPLE_ISSUER, createAppleClientSecret } from "./apple-client-secret.js";

const APPLE_REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;

/**
 * Keycloak coordinates for the admin API and the identity-broker endpoints.
 *
 * `KEYCLOAK_ADMIN_URL` exists for the same reason `KEYCLOAK_JWKS_URL` does (see
 * server/index.js): `issuer` must equal the exact `iss` claim in tokens, which
 * is the address the *browser* used to sign in. That address can be unroutable
 * from inside the API container, so admin traffic gets its own override and
 * falls back to the issuer's own origin when unset.
 */
export function readIdentityAdminConfig(env = process.env) {
  const issuer = String(env.KEYCLOAK_ISSUER || "").replace(/\/+$/, "");
  const match = /^(.*)\/realms\/([^/]+)$/.exec(issuer);
  const baseUrl = String(env.KEYCLOAK_ADMIN_URL || match?.[1] || "").replace(/\/+$/, "");
  const realm = match?.[2] || "";
  const clientId = String(env.KEYCLOAK_ADMIN_CLIENT_ID || "").trim();
  const clientSecret = String(env.KEYCLOAK_ADMIN_CLIENT_SECRET || "").trim();
  return {
    baseUrl,
    realm,
    clientId,
    clientSecret,
    configured: Boolean(baseUrl && realm && clientId && clientSecret)
  };
}

async function formPost(url, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString()
  });
}

export async function adminAccessToken(config) {
  const response = await formPost(
    `${config.baseUrl}/realms/${config.realm}/protocol/openid-connect/token`,
    { grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }
  );
  if (!response.ok) {
    throw new Error(`Keycloak admin authentication failed (${response.status})`);
  }
  const payload = await response.json();
  if (!payload.access_token) throw new Error("Keycloak admin authentication returned no access token");
  return payload.access_token;
}

/**
 * Reads the token Keycloak stored for the user's upstream identity provider.
 *
 * Works only because the `apple` provider is created with `storeToken` and
 * `addReadTokenRoleOnCreate` enabled (scripts/configure-keycloak.sh) — the
 * latter is what grants the user the `read-token` role this call needs.
 * The user's own bearer token is used rather than an admin one; the admin API
 * has no equivalent endpoint that returns stored broker tokens.
 *
 * Returns null when nothing is stored, which is the normal case for accounts
 * that were never federated through that provider.
 */
export async function readBrokerToken(config, userAccessToken, alias) {
  const response = await fetch(`${config.baseUrl}/realms/${config.realm}/broker/${alias}/token`, {
    headers: { authorization: `Bearer ${userAccessToken}` }
  });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Reading the ${alias} broker token failed (${response.status})`);
  const payload = await response.json();
  return payload.refresh_token || payload.access_token || null;
}

/**
 * Revokes a Sign in with Apple token.
 *
 * A token Apple already considers invalid (`invalid_grant`) is treated as
 * success: the goal is that the grant no longer exists, and it doesn't.
 * Every other failure throws, because silently skipping the revoke would leave
 * Novel Tracker listed under the reader's Apple ID after they deleted their
 * account — exactly what Apple's requirement exists to prevent.
 */
export async function revokeAppleToken(appleConfig, token) {
  if (!token) return { revoked: false, reason: "no-token" };

  const response = await formPost(APPLE_REVOKE_URL, {
    client_id: appleConfig.servicesId,
    client_secret: await createAppleClientSecret(appleConfig),
    token,
    token_type_hint: "refresh_token"
  });
  if (response.ok) return { revoked: true };

  const detail = await response.text().catch(() => "");
  if (response.status === 400 && detail.includes("invalid_grant")) {
    return { revoked: false, reason: "already-invalid" };
  }
  throw new Error(`Apple token revocation failed (${response.status}): ${detail.slice(0, 160)}`);
}

export async function deleteIdentityUser(config, subject) {
  const token = await adminAccessToken(config);
  const response = await fetch(
    `${config.baseUrl}/admin/realms/${config.realm}/users/${encodeURIComponent(subject)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } }
  );
  // Already gone is the desired end state, not an error.
  if (response.status === 404) return { deleted: false, reason: "not-found" };
  if (!response.ok) throw new Error(`Deleting the identity provider user failed (${response.status})`);
  return { deleted: true };
}
