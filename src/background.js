import {
  autoUpdateNovelProgress,
  buildSaveCandidate,
  deleteNovel,
  hasLocalLibraryData,
  importNovelsJson,
  restoreNovel,
  updateNovel,
  upsertNovel
} from "./lib/storage.js";
import { getExtensionApi } from "./lib/extension-api.js";
import { PARSER_FILES } from "./lib/site-parser-files.js";
import {
  cancelPendingAccount,
  confirmPendingAccount,
  getAccountStatus,
  signIn,
  signOut
} from "./lib/auth.js";
import { createSerialQueue, deleteAccount, getSyncStatus, syncNow } from "./lib/sync-service.js";

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
      const account = await signIn({
        provider: message.payload?.provider,
        hasLocalData: await hasLocalLibraryData()
      });
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
    case "novel-tracker:account-delete":
      await deleteAccount();
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

/* =========================================================
   SAVE WITHOUT THE POPUP (keyboard shortcut, context menu)
========================================================= */

// Both entry points grant activeTab for the tab they were used in, which is
// all executeScript needs. Neither API exists on Safari for iOS, so each is
// feature-detected; there the popup remains the way to save.
const SAVE_COMMAND = "save-chapter";
const SAVE_MENU_ID = "novel-tracker:save-chapter";
const BADGE_MS = 4000;

async function readTabMetadata(tabId) {
  await extensionApi.scripting.executeScript({ target: { tabId }, files: [...PARSER_FILES] });
  const [result] = await extensionApi.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.NovelTrackerPageMetadata.extractPageMetadata()
  });
  return result?.result;
}

async function showSaveResult(tabId, ok, title) {
  const action = extensionApi.action;
  if (!action?.setBadgeText) return;
  try {
    await action.setBadgeBackgroundColor?.({ tabId, color: ok ? "#597565" : "#aa4e46" });
    await action.setBadgeText({ tabId, text: ok ? "✓" : "!" });
    await action.setTitle?.({ tabId, title });
    setTimeout(() => {
      action.setBadgeText({ tabId, text: "" }).catch?.(() => {});
      action.setTitle?.({ tabId, title: "" })?.catch?.(() => {});
    }, BADGE_MS);
  } catch {
    // The tab may have closed; the save itself already happened.
  }
}

async function saveChapterFromTab(tab) {
  if (!tab?.id || !/^https?:/.test(tab.url || "")) return null;
  try {
    const metadata = await readTabMetadata(tab.id);
    if (!metadata?.lastReadChapterUrl) throw new Error("No chapter information on this page");
    const saved = await runLibraryWrite(upsertNovel, buildSaveCandidate(metadata));
    const label = [saved?.title, saved?.lastReadChapterLabel].filter(Boolean).join(" · ");
    await showSaveResult(tab.id, true, `Saved to Novel Tracker: ${label}`);
    return saved;
  } catch (error) {
    console.warn("Novel Tracker could not save this tab", error);
    await showSaveResult(tab.id, false, "Novel Tracker could not read this page. Try the popup instead.");
    return null;
  }
}

function createSaveMenu() {
  const menus = extensionApi.contextMenus;
  if (!menus?.create) return;
  // removeAll first: onInstalled and onStartup can both run in one session,
  // and creating an existing id throws.
  menus.removeAll(() => {
    menus.create({ id: SAVE_MENU_ID, title: "Save chapter to Novel Tracker", contexts: ["page"] }, () => {
      void extensionApi.runtime.lastError;
    });
  });
}

extensionApi.commands?.onCommand?.addListener((command, tab) => {
  if (command !== SAVE_COMMAND) return;
  if (tab) {
    saveChapterFromTab(tab);
    return;
  }
  // Older Firefox releases do not pass the tab to onCommand.
  extensionApi.tabs.query({ active: true, currentWindow: true }).then(([active]) => saveChapterFromTab(active));
});

extensionApi.contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId === SAVE_MENU_ID) saveChapterFromTab(tab);
});

// Playwright can press neither extension shortcuts nor browser context-menu
// items, so the e2e suite drives the shared handler through this instead.
globalThis.novelTrackerSaveChapterFromTab = saveChapterFromTab;

extensionApi.runtime.onInstalled?.addListener(createSaveMenu);
extensionApi.runtime.onStartup?.addListener(createSaveMenu);
