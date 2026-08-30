import {
  autoUpdateNovelProgress,
  deleteNovel,
  hasLocalLibraryData,
  importNovelsJson,
  restoreNovel,
  updateNovel,
  upsertNovel
} from "./lib/storage.js";
import { getExtensionApi } from "./lib/extension-api.js";
import {
  cancelPendingAccount,
  confirmPendingAccount,
  getAccountStatus,
  signIn,
  signOut
} from "./lib/auth.js";
import { createSerialQueue, deleteCloudAccount, getSyncStatus, syncNow } from "./lib/sync-service.js";

const extensionApi = getExtensionApi();

/**
 * Every library mutation runs here, one at a time.
 *
 * The popup and options pages are thin clients that message in rather than
 * writing storage themselves: each mutation is a read-modify-write of the
 * whole sync blob, so two contexts writing concurrently (a background
 * auto-progress landing while the user clicks Save) would let the later write
 * clobber the earlier one's pendingMutations and silently drop sync
 * operations. The queue extends that guarantee to the background's own
 * concurrent handlers.
 */
const libraryWrites = createSerialQueue();

// A Map, not an object literal: an object would answer to inherited keys like
// "constructor" for message types that were never registered.
const LIBRARY_WRITES = new Map([
  ["novel-tracker:auto-progress", (payload) => autoUpdateNovelProgress(payload)],
  ["novel-tracker:library-upsert", (payload) => upsertNovel(payload)],
  ["novel-tracker:library-update", (payload) => updateNovel(payload?.id, payload?.patch)],
  ["novel-tracker:library-delete", (payload) => deleteNovel(payload?.id)],
  ["novel-tracker:library-restore", (payload) => restoreNovel(payload?.id)],
  ["novel-tracker:library-import", (payload) => importNovelsJson(payload?.text)]
]);

async function runLibraryWrite(write, payload) {
  const result = await libraryWrites(() => write(payload));
  // storage.js announces pending work with a runtime message, which a service
  // worker never receives from itself — kick the sync explicitly here instead.
  // `updated: false` is autoUpdateNovelProgress reporting a no-op.
  if (result?.updated !== false) {
    syncNow().catch((error) => console.warn("Novel Tracker automatic sync deferred", error));
  }
  return result ?? { ok: true };
}

async function accountSnapshot() {
  return { account: await getAccountStatus(), sync: await getSyncStatus() };
}

async function handleMessage(message) {
  const libraryWrite = LIBRARY_WRITES.get(message?.type);
  if (libraryWrite) return runLibraryWrite(libraryWrite, message.payload);

  switch (message?.type) {
    case "novel-tracker:account-status":
      return accountSnapshot();
    case "novel-tracker:account-sign-in": {
      const account = await signIn({ hasLocalData: await hasLocalLibraryData() });
      if (!account.needsAccountConfirmation) await syncNow().catch(() => {});
      return accountSnapshot();
    }
    case "novel-tracker:account-confirm":
      await confirmPendingAccount();
      await syncNow().catch(() => {});
      return accountSnapshot();
    case "novel-tracker:account-cancel":
      await cancelPendingAccount();
      return accountSnapshot();
    case "novel-tracker:account-sign-out":
      await signOut();
      await syncNow();
      return accountSnapshot();
    case "novel-tracker:account-delete-cloud":
      await deleteCloudAccount();
      return accountSnapshot();
    case "novel-tracker:sync-now":
      await syncNow();
      return accountSnapshot();
    case "novel-tracker:sync-pending":
      syncNow().catch((error) => console.warn("Novel Tracker background sync deferred", error));
      return { accepted: true };
    default:
      return undefined;
  }
}

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type?.startsWith("novel-tracker:")) return false;
  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("Novel Tracker request failed", error);
      sendResponse({ error: error?.message || "Request failed" });
    });
  return true;
});

extensionApi.runtime.onStartup?.addListener(() => syncNow().catch(() => {}));
extensionApi.runtime.onInstalled?.addListener(() => {
  extensionApi.alarms?.create("novel-tracker:sync", { periodInMinutes: 15 });
  syncNow().catch(() => {});
});
extensionApi.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === "novel-tracker:sync") syncNow().catch(() => {});
});
