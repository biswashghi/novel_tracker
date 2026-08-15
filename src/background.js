import { autoUpdateNovelProgress } from "./lib/storage.js";
import { getExtensionApi } from "./lib/extension-api.js";

const extensionApi = getExtensionApi();

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
