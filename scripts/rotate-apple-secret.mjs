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
import { fileURLToPath } from "node:url";

const ALIAS = "apple";

export function appleProvider(appleConfig, clientSecret) {
  return {
    alias: ALIAS,
    displayName: "Apple",
    providerId: "apple",
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
      // The Apple provider handles Apple's form_post callback and the one-time
      // `user` body that generic OIDC cannot receive. Keep these explicit so
      // Keycloak Admin API provisioning is deterministic across deployments.
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
      teamId: appleConfig.teamId,
      keyId: appleConfig.keyId,
      defaultScope: "name email",
      pkceEnabled: "false",
      syncMode: "IMPORT"
    }
  };
}

export async function upsertAppleProvider(adminConfig, appleConfig, clientSecret, token, request = fetch) {
  const providerType = `${adminConfig.baseUrl}/admin/realms/${adminConfig.realm}/identity-provider/providers/apple`;
  const instances = `${adminConfig.baseUrl}/admin/realms/${adminConfig.realm}/identity-provider/instances`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const desired = appleProvider(appleConfig, clientSecret);

  const problem = async (action, response) => {
    const detail = await response.text().catch(() => "");
    return new Error(`${action} the ${ALIAS} identity provider failed (${response.status}): ${detail.slice(0, 200)}`);
  };
  const verifyAppleType = async () => {
    const verified = await request(`${instances}/${ALIAS}`, { headers });
    if (!verified.ok || (await verified.json()).providerId !== "apple") {
      throw new Error(`The ${ALIAS} provider was created but its type could not be verified as apple`);
    }
  };

  // Do not remove the legacy alias unless Keycloak has loaded the JAR.
  const available = await request(providerType, { headers });
  if (!available.ok) {
    throw new Error(`The Apple Keycloak provider JAR is not loaded or readable (${available.status}); refusing to update the apple identity provider`);
  }

  const existing = await request(`${instances}/${ALIAS}`, { headers });
  if (existing.status !== 200 && existing.status !== 404) {
    throw new Error(`Reading the ${ALIAS} identity provider failed (${existing.status})`);
  }

  if (existing.status === 404) {
    const created = await request(instances, { method: "POST", headers, body: JSON.stringify(desired) });
    if (!created.ok) throw await problem("Creating", created);
    await verifyAppleType();
    return "Created";
  }

  const previous = await existing.json();
  const updated = {
    ...previous,
    ...desired,
    // Preserve any non-Apple tuning while replacing the fields this script
    // owns, including the generated client secret and Apple-specific keys.
    config: { ...previous.config, ...desired.config }
  };

  if (previous.providerId === "apple") {
    const refreshed = await request(`${instances}/${ALIAS}`, { method: "PUT", headers, body: JSON.stringify(updated) });
    if (!refreshed.ok) throw await problem("Refreshing", refreshed);
    return "Refreshed";
  }

  if (previous.providerId !== "oidc") {
    throw new Error(`Refusing to replace ${ALIAS}: unexpected Keycloak provider type ${previous.providerId}`);
  }

  // Keycloak 26.1 silently keeps providerId=oidc on PUT. There are no active
  // Apple accounts on this legacy instance, so replace it completely.
  const removed = await request(`${instances}/${ALIAS}`, { method: "DELETE", headers });
  if (!removed.ok) throw await problem("Removing the generic", removed);

  const migrated = await request(instances, { method: "POST", headers, body: JSON.stringify(desired) });
  if (!migrated.ok) throw await problem("Migrating", migrated);

  await verifyAppleType();
  return "Migrated";
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
  const action = await upsertAppleProvider(adminConfig, appleConfig, clientSecret, token);
  console.log(`${action} the ${ALIAS} identity provider in realm ${adminConfig.realm}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
