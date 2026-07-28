(function () {
  let lastProcessedUrl = "";
  let debounceId = null;
  let extensionAvailable = true;

  function canUseExtensionRuntime() {
    if (!extensionAvailable) {
      return false;
    }

    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch (error) {
      if (String(error?.message || error).includes("Extension context invalidated")) {
        extensionAvailable = false;
        return false;
      }

      throw error;
    }
  }

  function sendProgressUpdate() {
    const currentUrl = window.location.href;
    if (!currentUrl.startsWith("http") || currentUrl === lastProcessedUrl) {
      return;
    }

    if (!canUseExtensionRuntime()) {
      return;
    }

    lastProcessedUrl = currentUrl;
    const payload = globalThis.NovelTrackerPageMetadata.extractPageMetadata();

    try {
      chrome.runtime.sendMessage(
        {
          type: "novel-tracker:auto-progress",
          payload
        },
        () => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError?.message?.includes("Extension context invalidated")) {
            extensionAvailable = false;
          }
        }
      );
    } catch (error) {
      if (String(error?.message || error).includes("Extension context invalidated")) {
        extensionAvailable = false;
        return;
      }

      throw error;
    }
  }

  function scheduleProgressUpdate() {
    window.clearTimeout(debounceId);
    debounceId = window.setTimeout(sendProgressUpdate, 350);
  }

  const originalPushState = history.pushState;
  history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    scheduleProgressUpdate();
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    scheduleProgressUpdate();
    return result;
  };

  window.addEventListener("popstate", scheduleProgressUpdate);
  window.addEventListener("hashchange", scheduleProgressUpdate);

  const observer = new MutationObserver(() => {
    if (window.location.href !== lastProcessedUrl) {
      scheduleProgressUpdate();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  scheduleProgressUpdate();
})();
