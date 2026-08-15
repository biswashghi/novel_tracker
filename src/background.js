import { autoUpdateNovelProgress } from "./lib/storage.js";
import { getExtensionApi } from "./lib/extension-api.js";
import {
  cancelPendingAccount,
  confirmPendingAccount,
  getAccountStatus,
  signIn,
  signOut
} from "./lib/auth.js";
import { deleteCloudAccount, getSyncStatus, syncNow } from "./lib/sync-service.js";
import { hasLocalLibraryData } from "./lib/storage.js";

const extensionApi = getExtensionApi();

async function accountSnapshot() {
  return { account: await getAccountStatus(), sync: await getSyncStatus() };
}

async function handleMessage(message) {
  switch (message?.type) {
    case "novel-tracker:auto-progress":
      return autoUpdateNovelProgress(message.payload);
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
