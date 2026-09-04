import { getStorageLocal } from "./extension-api.js";
import { getAuthPlatform } from "./auth-platform.js";
import { platformFetch } from "./platform-http.js";
import { AUTH_PROVIDERS, AUTH_ISSUER } from "./config.js";

export const AUTH_STORAGE_KEY = "novel-tracker:auth";
export const AUTH_CONFIG = Object.freeze({
  issuer: AUTH_ISSUER,
  clientId: "novel-tracker-extension",
  scopes: "openid profile email offline_access"
});

function storageArea() {
  const storage = getStorageLocal();
  if (!storage) throw new Error("Extension storage is unavailable");
  return storage;
}

// Google and Apple are deliberately separate accounts even for the same person
// and the same email address, so every token record carries the provider that
// minted it. The UI uses it to tell readers which library they're looking at,
// and the delete flow uses it to decide whether Apple's token also has to be
// revoked (Apple requires that on account deletion).
function resolveProvider(providerId) {
  if (!providerId) return AUTH_PROVIDERS[0];
  const provider = AUTH_PROVIDERS.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error(`Unknown sign-in provider: ${providerId}`);
  return provider;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomValue(size = 32) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(value) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function decodeJwtPayload(token) {
  try {
    const encoded = String(token || "").split(".")[1];
    if (!encoded) return {};
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

async function readAuth() {
  const result = await storageArea().get(AUTH_STORAGE_KEY);
  return result[AUTH_STORAGE_KEY] || { active: null, pending: null, lastSubject: "", lastEmail: "", lastProvider: "" };
}

async function writeAuth(auth) {
  await storageArea().set({ [AUTH_STORAGE_KEY]: auth });
  return auth;
}

function publicAccount(auth) {
  const token = auth.active;
  return {
    signedIn: Boolean(token?.accessToken),
    subject: token?.subject || "",
    email: token?.email || "",
    name: token?.name || token?.email || "",
    provider: token?.provider || "",
    expiresAt: Number(token?.expiresAt || 0),
    lastSubject: auth.lastSubject || "",
    lastEmail: auth.lastEmail || "",
    lastProvider: auth.lastProvider || "",
    needsAccountConfirmation: Boolean(auth.pending),
    pendingEmail: auth.pending?.email || "",
    pendingProvider: auth.pending?.provider || ""
  };
}

export function oauthRedirectUri(generatedUrl) {
  const redirect = new URL(generatedUrl);
  if (redirect.hostname.endsWith(".extensions.allizom.org")) {
    const extensionSubdomain = redirect.hostname.slice(0, -".extensions.allizom.org".length);
    if (!extensionSubdomain || extensionSubdomain.includes(".")) {
      throw new Error("Firefox returned an invalid extension callback URL");
    }
    return `http://127.0.0.1/mozoauth2/${extensionSubdomain}`;
  }
  return redirect.toString();
}

async function exchangeToken(parameters) {
  const url = `${AUTH_CONFIG.issuer}/protocol/openid-connect/token`;
  const formBody = new URLSearchParams(parameters).toString();
  const response = await platformFetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Sign-in token exchange failed (${response.status}): ${detail.slice(0, 160)}`);
  }
  return response.json();
}

function tokenRecord(tokens, previous = {}, requestedProvider = "") {
  const claims = decodeJwtPayload(tokens.id_token || tokens.access_token);
  const expiresIn = Number(tokens.expires_in || 300);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || previous.refreshToken || "",
    idToken: tokens.id_token || previous.idToken || "",
    expiresAt: Date.now() + Math.max(0, expiresIn - 30) * 1000,
    subject: String(claims.sub || previous.subject || ""),
    email: String(claims.email || previous.email || ""),
    name: String(claims.name || claims.preferred_username || previous.name || ""),
    // `provider` is a Keycloak protocol mapper over the `identity_provider`
    // session note (see scripts/configure-keycloak.sh). Falling back to the
    // requested id keeps this correct against realms without that mapper,
    // such as the local/e2e stack.
    provider: String(claims.provider || previous.provider || requestedProvider || "")
  };
}

async function importSafariSession(auth, platform = getAuthPlatform()) {
  if (platform.kind !== "safari-native" || auth.active?.accessToken) return auth;
  const shared = await platform.sharedSession();
  if (!shared?.accessToken) return auth;
  auth.active = tokenRecord({
    access_token: shared.accessToken,
    refresh_token: shared.refreshToken,
    id_token: shared.idToken,
    expires_in: Math.max(0, Math.ceil((Number(shared.expiresAt || 0) - Date.now()) / 1000))
  }, shared);
  auth.lastSubject = auth.active.subject;
  auth.lastEmail = auth.active.email;
  auth.lastProvider = auth.active.provider;
  await writeAuth(auth);
  return auth;
}

async function persistSafariSession(session, platform) {
  if (platform.kind === "safari-native") await platform.storeSharedSession(session);
}

export async function getAccountStatus() {
  return publicAccount(await importSafariSession(await readAuth()));
}

export async function signIn({ provider: providerId = "", hasLocalData = false } = {}) {
  const provider = resolveProvider(providerId);
  const platform = getAuthPlatform();
  if (platform.kind === "safari-native") {
    const shared = await platform.sharedSession();
    if (shared?.accessToken) return activateTokens(tokenRecord({
      access_token: shared.accessToken,
      refresh_token: shared.refreshToken,
      id_token: shared.idToken,
      expires_in: Math.max(0, Math.ceil((Number(shared.expiresAt || 0) - Date.now()) / 1000))
    }, shared), hasLocalData, platform);
  }

  const redirectUri = oauthRedirectUri(platform.redirectUri("oauth2"));
  const verifier = randomValue(64);
  const state = randomValue(24);
  const authorize = new URL(`${AUTH_CONFIG.issuer}/protocol/openid-connect/auth`);
  const authorizeParams = {
    client_id: AUTH_CONFIG.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: AUTH_CONFIG.scopes,
    state,
    nonce: randomValue(24),
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256"
  };
  if (provider.idpHint) authorizeParams.kc_idp_hint = provider.idpHint;
  authorize.search = new URLSearchParams(authorizeParams).toString();

  const callbackUrl = new URL(await platform.authorize(authorize.toString()));
  if (callbackUrl.searchParams.get("state") !== state) throw new Error("Sign-in state validation failed");
  const providerError = callbackUrl.searchParams.get("error");
  if (providerError) throw new Error(callbackUrl.searchParams.get("error_description") || providerError);
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("Sign-in did not return an authorization code");
  const tokenPayload = await exchangeToken({
    grant_type: "authorization_code",
    client_id: AUTH_CONFIG.clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier
  });
  return activateTokens(tokenRecord(tokenPayload, {}, provider.id), hasLocalData, platform);
}

async function activateTokens(tokens, hasLocalData, platform) {
  if (!tokens.subject) throw new Error("Sign-in token did not identify an account");

  const auth = await readAuth();
  if (hasLocalData && auth.lastSubject && auth.lastSubject !== tokens.subject) {
    auth.pending = tokens;
    await writeAuth(auth);
    return {
      ...publicAccount(auth),
      needsAccountConfirmation: true,
      pendingEmail: tokens.email,
      pendingProvider: tokens.provider
    };
  }

  auth.active = tokens;
  auth.pending = null;
  auth.lastSubject = tokens.subject;
  auth.lastEmail = tokens.email;
  auth.lastProvider = tokens.provider;
  await writeAuth(auth);
  await persistSafariSession(tokens, platform);
  return publicAccount(auth);
}

export async function confirmPendingAccount() {
  const auth = await readAuth();
  if (!auth.pending) throw new Error("No account change is waiting for confirmation");
  auth.active = auth.pending;
  auth.pending = null;
  auth.lastSubject = auth.active.subject;
  auth.lastEmail = auth.active.email;
  auth.lastProvider = auth.active.provider;
  await writeAuth(auth);
  await persistSafariSession(auth.active, getAuthPlatform());
  return publicAccount(auth);
}

export async function cancelPendingAccount() {
  const auth = await readAuth();
  auth.pending = null;
  await writeAuth(auth);
  const platform = getAuthPlatform();
  if (platform.kind === "safari-native") {
    if (auth.active) await platform.storeSharedSession(auth.active);
    else await platform.clearSharedSession();
  }
  return publicAccount(auth);
}

const TOKEN_EXPIRY_SKEW_MS = 30_000;
let refreshInFlight = null;

export async function getAccessToken() {
  const platform = getAuthPlatform();
  const auth = await importSafariSession(await readAuth(), platform);
  if (!auth.active?.accessToken) return "";
  if (auth.active.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS) return auth.active.accessToken;
  if (!auth.active.refreshToken) {
    auth.active = null;
    await writeAuth(auth);
    if (platform.kind === "safari-native") await platform.clearSharedSession();
    return "";
  }
  // Single-flight: concurrent callers share one refresh exchange so parallel
  // 401 retries can't thrash (or invalidate each other under rotation).
  refreshInFlight ||= refreshTokens(auth.active.refreshToken, platform);
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function refreshTokens(refreshToken, platform) {
  const auth = await readAuth();
  try {
    const refreshed = await exchangeToken({
      grant_type: "refresh_token",
      client_id: AUTH_CONFIG.clientId,
      refresh_token: refreshToken
    });
    auth.active = tokenRecord(refreshed, auth.active || { refreshToken });
    auth.lastSubject = auth.active.subject;
    auth.lastEmail = auth.active.email;
    auth.lastProvider = auth.active.provider;
    await writeAuth(auth);
    await persistSafariSession(auth.active, platform);
    return auth.active.accessToken;
  } catch (error) {
    const current = await readAuth();
    if (current.active?.refreshToken === refreshToken) {
      current.active = null;
      await writeAuth(current);
      if (platform.kind === "safari-native") await platform.clearSharedSession();
    }
    throw error;
  }
}

export async function signOut() {
  const platform = getAuthPlatform();
  const auth = await readAuth();
  const refreshToken = auth.active?.refreshToken;
  auth.active = null;
  auth.pending = null;
  await writeAuth(auth);
  if (platform.kind === "safari-native") await platform.clearSharedSession();
  if (refreshToken) {
    platformFetch(`${AUTH_CONFIG.issuer}/protocol/openid-connect/logout`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: AUTH_CONFIG.clientId, refresh_token: refreshToken })
    }).catch(() => {});
  }
  return publicAccount(auth);
}
