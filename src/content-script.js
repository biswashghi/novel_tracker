(function () {
  const extensionApi = globalThis.browser || globalThis.chrome;
  let lastProcessedUrl = "";
  let debounceId = null;
  let extensionAvailable = true;
  let readinessUrl = "";
  let readinessAttempts = 0;
  const MAX_READINESS_ATTEMPTS = 12;

  function canUseExtensionRuntime() {
    if (!extensionAvailable) {
      return false;
    }

    try {
      return Boolean(extensionApi?.runtime?.id);
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

    const payload = globalThis.NovelTrackerPageMetadata.extractPageMetadata();

    if (payload?.autoProgressReady === false) {
      if (readinessUrl !== currentUrl) {
        readinessUrl = currentUrl;
        readinessAttempts = 0;
      }

      if (readinessAttempts < MAX_READINESS_ATTEMPTS) {
        readinessAttempts += 1;
        scheduleProgressUpdate();
      } else {
        // Do not send guessed metadata for a page that never became ready,
        // and stop retrying until its URL changes.
        lastProcessedUrl = currentUrl;
      }
      return;
    }

    lastProcessedUrl = currentUrl;
    readinessUrl = "";
    readinessAttempts = 0;

    try {
      Promise.resolve(extensionApi.runtime.sendMessage({
        type: "novel-tracker:auto-progress",
        payload
      })).catch((error) => {
        if (String(error?.message || error).includes("Extension context invalidated")) {
          extensionAvailable = false;
        }
      });
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
