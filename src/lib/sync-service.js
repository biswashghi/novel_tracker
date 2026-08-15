import { getAccessToken, getAccountStatus, signOut } from "./auth.js";
import { getStorageLocal } from "./extension-api.js";
import { disconnectSyncAccount, getSyncState, prepareSyncForAccount, saveSyncState } from "./storage.js";
import { SyncClient } from "./sync-client.js";

export const SYNC_META_KEY = "novel-tracker:sync-meta";
const API_BASE_URL = "https://api.novel.bghimire.com";
let activeSync = null;

function storageArea() {
  const storage = getStorageLocal();
  if (!storage) throw new Error("Extension storage is unavailable");
  return storage;
}

async function writeMeta(patch) {
  const current = await getSyncStatus();
  const next = { ...current, ...patch };
  await storageArea().set({ [SYNC_META_KEY]: next });
  return next;
}

export async function getSyncStatus() {
  const result = await storageArea().get(SYNC_META_KEY);
  return result[SYNC_META_KEY] || {
    state: "local-only",
    lastSyncedAt: "",
    lastError: ""
  };
}

async function synchronize() {
  const account = await getAccountStatus();
  if (!account.signedIn) {
    return writeMeta({ state: "local-only", lastError: "" });
  }
  await writeMeta({ state: "syncing", lastError: "" });
  try {
    let state = await prepareSyncForAccount(account.subject);
    const client = new SyncClient({ baseUrl: API_BASE_URL, getAccessToken });
    state = (await client.pull(state)).state;
    await saveSyncState(state);
    state = (await client.push(state)).state;
    await saveSyncState(state);
    state = (await client.pull(state)).state;
    await saveSyncState(state);
    return writeMeta({ state: "synced", lastSyncedAt: new Date().toISOString(), lastError: "" });
  } catch (error) {
    await writeMeta({ state: "error", lastError: error?.message || "Synchronization failed" });
    throw error;
  }
}

export function syncNow() {
  if (!activeSync) {
    activeSync = synchronize().finally(() => {
      activeSync = null;
    });
  }
  return activeSync;
}

export async function deleteCloudAccount() {
  const token = await getAccessToken();
  if (!token) throw new Error("Sign in is required to delete cloud data");
  const response = await fetch(`${API_BASE_URL}/v1/account`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Cloud account deletion failed (${response.status})`);
  await signOut();
  await disconnectSyncAccount();
  return writeMeta({ state: "local-only", lastSyncedAt: "", lastError: "" });
}
