// Sign in with Apple does not issue a static client secret. Instead, every
// caller signs a short-lived ES256 JWT with the private key downloaded from the
// Apple Developer portal, and passes that JWT wherever OAuth expects
// `client_secret`.
//
// Two callers need it, which is why this lives on its own:
//   - the account-deletion path, which must revoke the user's Apple token
//     (server/identity-admin.js);
//   - scripts/rotate-apple-secret.mjs, which refreshes the copy Keycloak holds
//     for the `apple` identity provider.
//
// Apple caps the lifetime at six months. An expired secret breaks every Apple
// sign-in at once and fails in a way that looks like a Keycloak problem rather
// than an expiry, so the rotation job is not optional.
import { SignJWT, importPKCS8 } from "jose";

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_MAX_SECRET_LIFETIME_SECONDS = 15_777_000; // Apple's ceiling: ~6 months.

/**
 * Reads the Apple credentials out of the environment.
 *
 * `APPLE_PRIVATE_KEY` holds the contents of the `.p8` file. Env files and CI
 * secrets routinely flatten the newlines out of PEM data, so escaped `\n`
 * sequences are restored here rather than at each call site.
 */
export function readAppleConfig(env = process.env) {
  const teamId = String(env.APPLE_TEAM_ID || "").trim();
  const servicesId = String(env.APPLE_SERVICES_ID || "").trim();
  const keyId = String(env.APPLE_KEY_ID || "").trim();
  const privateKey = String(env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  return {
    teamId,
    servicesId,
    keyId,
    privateKey,
    configured: Boolean(teamId && servicesId && keyId && privateKey)
  };
}

export async function createAppleClientSecret(config, lifetimeSeconds = APPLE_MAX_SECRET_LIFETIME_SECONDS) {
  if (!config?.configured) {
    throw new Error("Sign in with Apple is not configured (APPLE_TEAM_ID, APPLE_SERVICES_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY)");
  }
  if (!(lifetimeSeconds > 0) || lifetimeSeconds > APPLE_MAX_SECRET_LIFETIME_SECONDS) {
    throw new Error(`Apple client secret lifetime must be between 1 and ${APPLE_MAX_SECRET_LIFETIME_SECONDS} seconds`);
  }

  const key = await importPKCS8(config.privateKey, "ES256");
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    // `sub` is the Services ID (the web/OAuth client), not the app's bundle id.
    .setIssuer(config.teamId)
    .setSubject(config.servicesId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + lifetimeSeconds)
    .sign(key);
}
