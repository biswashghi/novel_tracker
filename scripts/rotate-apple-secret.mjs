#!/usr/bin/env node
// Creates or refreshes the `apple` identity provider in Keycloak.
//
// Sign in with Apple has no static client secret: it expects an ES256 JWT that
// Apple caps at six months. When it lapses every Apple sign-in fails at once,
// and the error surfaces as a generic Keycloak broker failure rather than
// anything that mentions expiry — so this runs on a timer
// (infra/novel-tracker-apple-secret.timer) as well as on deployment.
//
// One place owns the Apple secret. `scripts/configure-keycloak.sh` deliberately
// handles only the secret-free realm and mapper configuration.
//
// Usage: node scripts/rotate-apple-secret.mjs
// Requires APPLE_* and KEYCLOAK_ADMIN_* in the environment (see docs/operations.md).
import { createAppleClientSecret, readAppleConfig, APPLE_ISSUER } from "../server/apple-client-secret.js";
import { adminAccessToken, readIdentityAdminConfig } from "../server/identity-admin.js";

const ALIAS = "apple";

function appleProvider(appleConfig, clientSecret) {
  return {
    alias: ALIAS,
    displayName: "Apple",
    providerId: "oidc",
    enabled: true,
    // Apple verifies addresses (including its private relay ones), so there is
    // nothing for Novel Tracker to re-verify.
    trustEmail: true,
    // Both are required by account deletion: the stored Apple refresh token is
    // what gets revoked, and `read-token` is the role that lets the API read it
    // back out of the broker endpoint.
    storeToken: true,
    addReadTokenRoleOnCreate: true,
    linkOnly: false,
    // The stock flow is correct here. Its duplicate-account check looks users up
    // by email only when the realm forbids duplicate emails; because
    // configure-keycloak.sh allows them, an Apple sign-in whose address matches
    // an existing Google account creates a separate user instead of
    // interrupting with "account already exists" — which is both the intended
    // product behaviour and unusable inside an extension popup.
    firstBrokerLoginFlowAlias: "first broker login",
    config: {
      issuer: APPLE_ISSUER,
      // `response_mode=form_post` is not optional: Apple rejects the
      // authorization request whenever `name` or `email` is in scope without
      // it, and Keycloak's generic OIDC provider exposes no field for it, so it
      // rides along on the URL.
      authorizationUrl: `${APPLE_ISSUER}/auth/authorize?response_mode=form_post`,
      tokenUrl: `${APPLE_ISSUER}/auth/token`,
      jwksUrl: `${APPLE_ISSUER}/auth/keys`,
      useJwksUrl: "true",
      validateSignature: "true",
      clientAuthMethod: "client_secret_post",
      // Apple's web flow authenticates as the Services ID, never the app's
      // bundle identifier.
      clientId: appleConfig.servicesId,
      clientSecret,
      defaultScope: "openid name email",
      pkceEnabled: "false",
      syncMode: "IMPORT"
    }
  };
}

async function main() {
  const appleConfig = readAppleConfig();
  const adminConfig = readIdentityAdminConfig();

  if (!appleConfig.configured) {
    throw new Error("Missing APPLE_TEAM_ID, APPLE_SERVICES_ID, APPLE_KEY_ID, or APPLE_PRIVATE_KEY");
  }
  if (!adminConfig.configured) {
    throw new Error("Missing KEYCLOAK_ISSUER, KEYCLOAK_ADMIN_CLIENT_ID, or KEYCLOAK_ADMIN_CLIENT_SECRET");
  }

  const clientSecret = await createAppleClientSecret(appleConfig);
  const token = await adminAccessToken(adminConfig);
  const instances = `${adminConfig.baseUrl}/admin/realms/${adminConfig.realm}/identity-provider/instances`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const existing = await fetch(`${instances}/${ALIAS}`, { headers });
  if (existing.status !== 200 && existing.status !== 404) {
    throw new Error(`Reading the ${ALIAS} identity provider failed (${existing.status})`);
  }

  const created = existing.status === 404;
  const response = created
    ? await fetch(instances, { method: "POST", headers, body: JSON.stringify(appleProvider(appleConfig, clientSecret)) })
    : await fetch(`${instances}/${ALIAS}`, {
        method: "PUT",
        headers,
        // Merge rather than replace: anything tuned by hand in the admin console
        // survives, while the fields this script owns are re-asserted.
        body: JSON.stringify({
          ...(await existing.json()),
          ...appleProvider(appleConfig, clientSecret)
        })
      });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${created ? "Creating" : "Updating"} the ${ALIAS} identity provider failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  console.log(`${created ? "Created" : "Refreshed"} the ${ALIAS} identity provider in realm ${adminConfig.realm}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
