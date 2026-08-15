import { getStorageLocal } from "./extension-api.js";
import { getAuthPlatform } from "./auth-platform.js";
import { platformFetch } from "./platform-http.js";

export const AUTH_STORAGE_KEY = "novel-tracker:auth";
export const AUTH_CONFIG = Object.freeze({
  issuer: "https://auth.novel.bghimire.com/realms/novel-tracker",
  clientId: "novel-tracker-extension",
  scopes: "openid profile email offline_access"
});

function storageArea() {
  const storage = getStorageLocal();
  if (!storage) throw new Error("Extension storage is unavailable");
  return storage;
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
  return result[AUTH_STORAGE_KEY] || { active: null, pending: null, lastSubject: "", lastEmail: "" };
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
    expiresAt: Number(token?.expiresAt || 0),
    lastSubject: auth.lastSubject || "",
    lastEmail: auth.lastEmail || "",
    needsAccountConfirmation: Boolean(auth.pending),
    pendingEmail: auth.pending?.email || ""
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

function tokenRecord(tokens, previous = {}) {
  const claims = decodeJwtPayload(tokens.id_token || tokens.access_token);
  const expiresIn = Number(tokens.expires_in || 300);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || previous.refreshToken || "",
    idToken: tokens.id_token || previous.idToken || "",
    expiresAt: Date.now() + Math.max(0, expiresIn - 30) * 1000,
    subject: String(claims.sub || previous.subject || ""),
    email: String(claims.email || previous.email || ""),
    name: String(claims.name || claims.preferred_username || previous.name || "")
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
  await writeAuth(auth);
  return auth;
}

async function persistSafariSession(session, platform) {
  if (platform.kind === "safari-native") await platform.storeSharedSession(session);
}

export async function getAccountStatus() {
  return publicAccount(await importSafariSession(await readAuth()));
}

export async function signIn({ hasLocalData = false } = {}) {
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
    authorize.search = new URLSearchParams({
      client_id: AUTH_CONFIG.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: AUTH_CONFIG.scopes,
      state,
      nonce: randomValue(24),
      code_challenge: await sha256(verifier),
      code_challenge_method: "S256",
      kc_idp_hint: "google"
    }).toString();

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
  return activateTokens(tokenRecord(tokenPayload), hasLocalData, platform);
}

async function activateTokens(tokens, hasLocalData, platform) {
  if (!tokens.subject) throw new Error("Sign-in token did not identify an account");

  const auth = await readAuth();
  if (hasLocalData && auth.lastSubject && auth.lastSubject !== tokens.subject) {
    auth.pending = tokens;
    await writeAuth(auth);
    return { ...publicAccount(auth), needsAccountConfirmation: true, pendingEmail: tokens.email };
  }

  auth.active = tokens;
  auth.pending = null;
  auth.lastSubject = tokens.subject;
  auth.lastEmail = tokens.email;
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

export async function getAccessToken() {
  const platform = getAuthPlatform();
  const auth = await importSafariSession(await readAuth(), platform);
  if (!auth.active?.accessToken) return "";
  if (auth.active.expiresAt > Date.now()) return auth.active.accessToken;
  if (!auth.active.refreshToken) {
    auth.active = null;
    await writeAuth(auth);
    if (platform.kind === "safari-native") await platform.clearSharedSession();
    return "";
  }
  try {
    const refreshed = await exchangeToken({
      grant_type: "refresh_token",
      client_id: AUTH_CONFIG.clientId,
      refresh_token: auth.active.refreshToken
    });
    auth.active = tokenRecord(refreshed, auth.active);
    auth.lastSubject = auth.active.subject;
    auth.lastEmail = auth.active.email;
    await writeAuth(auth);
    await persistSafariSession(auth.active, platform);
    return auth.active.accessToken;
  } catch (error) {
    auth.active = null;
    await writeAuth(auth);
    if (platform.kind === "safari-native") await platform.clearSharedSession();
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
