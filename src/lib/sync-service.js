import { getAccessToken, getAccountStatus, signOut } from "./auth.js";
import { platformFetch } from "./platform-http.js";
import { getStorageLocal } from "./extension-api.js";
import { disconnectSyncAccount, getSyncState, prepareSyncForAccount, saveSyncState } from "./storage.js";
import { SyncClient } from "./sync-client.js";
import { API_BASE_URL } from "./config.js";

export const SYNC_META_KEY = "novel-tracker:sync-meta";

export function createQueuedTask(task) {
  let activeTask = null;
  let rerunRequested = false;
  return function run() {
    if (activeTask) {
      rerunRequested = true;
      return activeTask;
    }
    activeTask = (async () => {
      do {
        rerunRequested = false;
        await task();
      } while (rerunRequested);
    })().finally(() => {
      activeTask = null;
    });
    return activeTask;
  };
}

/**
 * Serializes distinct write tasks in submission order.
 *
 * Not the same shape as createQueuedTask above: that one collapses repeat runs
 * of a single idempotent job, which is right for "sync again" but wrong for
 * library mutations — collapsing them would silently drop writes.
 */
export function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const result = tail.then(task, task);
    // Keep the chain alive regardless of how the caller's task settled; the
    // caller still receives the original (possibly rejecting) promise.
    tail = result.then(() => {}, () => {});
    return result;
  };
}

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
    const client = new SyncClient({ baseUrl: API_BASE_URL, getAccessToken, fetchImpl: platformFetch });
    state = (await client.pull(state)).state;
    await saveSyncState(state);
    const pushed = await client.push(state);
    state = pushed.state;
    await saveSyncState(state);
    state = (await client.pull(state)).state;
    await saveSyncState(state);
    const rejected = pushed.rejected || [];
    if (rejected.length) {
      const reasons = [...new Set(rejected.map((item) => item.reason))].join(", ");
      return writeMeta({
        state: "synced",
        lastSyncedAt: new Date().toISOString(),
        lastError: `${rejected.length} change${rejected.length === 1 ? "" : "s"} rejected (${reasons})`
      });
    }
    return writeMeta({ state: "synced", lastSyncedAt: new Date().toISOString(), lastError: "" });
  } catch (error) {
    await writeMeta({ state: "error", lastError: error?.message || "Synchronization failed" });
    throw error;
  }
}

const runQueuedSync = createQueuedTask(synchronize);

export function syncNow() {
  return runQueuedSync();
}

export async function deleteCloudAccount() {
  const token = await getAccessToken();
  if (!token) throw new Error("Sign in is required to delete cloud data");
  const response = await platformFetch(`${API_BASE_URL}/v1/account`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Cloud account deletion failed (${response.status})`);
  await signOut();
  await disconnectSyncAccount();
  return writeMeta({ state: "local-only", lastSyncedAt: "", lastError: "" });
}
