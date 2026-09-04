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

// Sign-in options offered to the reader, in display order. Each entry is one
// Keycloak identity provider: `idpHint` becomes `kc_idp_hint` on the authorize
// request, which skips Keycloak's own provider chooser and goes straight to
// Google or Apple. Adding a provider is a config change, not a code change —
// auth.js, the options page, and the iOS app all iterate this list.
//
// Apple is required by App Store guideline 4.8 (it collects only name and
// email, offers private email relay, and does not track for advertising).
// It is brokered through Keycloak like Google is, so the OAuth/PKCE flow is
// identical for both and works in every browser, not just Safari.
//
// Local/e2e realms don't federate anything, so `--env=local` builds replace
// this with a single hint-less entry and let Keycloak show its own login form
// for the seeded test user instead.
// `icon` names a sprite symbol (`#i-<icon>`) defined in options.html.
export const AUTH_PROVIDERS = Object.freeze([
  Object.freeze({ id: "google", label: "Sign in with Google", idpHint: "google", icon: "google" }),
  Object.freeze({ id: "apple", label: "Sign in with Apple", idpHint: "apple", icon: "apple" })
]);
