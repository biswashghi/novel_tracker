import { autoUpdateNovelProgress } from "./lib/storage.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "novel-tracker:auto-progress") {
    autoUpdateNovelProgress(message.payload)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        console.error("Novel Tracker auto-update failed", error);
        sendResponse({ updated: false, reason: "error" });
      });

    return true;
  }

  return false;
});
