// Runtime configuration for API/auth endpoints.
//
// The values checked into source control here are the production defaults
// used by `npm run build`, `npm run build:firefox`, and `npm run build:safari`.
// `scripts/build.mjs --env=local` overwrites this file inside the build
// output (dist/, dist-firefox/, dist-safari/) with local Docker-stack
// endpoints so the extension can be exercised against
// `infra/docker-compose.yml` (see docs/testing-locally.md) — it never
// modifies this source file.
export const API_BASE_URL = "https://api.novel.bghimire.com";
export const AUTH_ISSUER = "https://auth.novel.bghimire.com/realms/novel-tracker";

// Keycloak `kc_idp_hint` used to skip straight to Google on the hosted
// production realm. Local/e2e realms don't federate Google, so
// `--env=local` builds clear this to let Keycloak show its own login form
// for the seeded test user instead.
export const AUTH_IDP_HINT = "google";
