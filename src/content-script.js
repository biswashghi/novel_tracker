(function () {
  function cleanTitle(title) {
    return String(title || "")
      .replace(/\s+/g, " ")
      .replace(/\s+[-|:]\s+[^-|:]+$/, "")
      .trim();
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const value = node?.textContent?.trim();
      if (value) {
        return value;
      }
    }

    return "";
  }

  function metaContent(name, attr = "property") {
    return document.querySelector(`meta[${attr}="${name}"]`)?.content?.trim() || "";
  }

  function titleCaseFromSlug(slug) {
    return String(slug || "")
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function normalizePathUrl(url, pathname) {
    try {
      const parsed = new URL(url);
      parsed.pathname = pathname;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return url;
    }
  }

  function parseSiteSpecificMetadata(url, ogTitle, ogImage) {
    const hostname = url.hostname.replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);

    if (hostname === "royalroad.com") {
      const fictionIndex = segments.indexOf("fiction");
      if (fictionIndex >= 0 && segments.length >= fictionIndex + 3) {
        const fictionId = segments[fictionIndex + 1];
        const fictionSlug = segments[fictionIndex + 2];
        const chapterSlug = segments[segments.length - 1];
        return {
          title:
            firstText([".fic-title h1", ".font-white", "h1"]) ||
            titleCaseFromSlug(fictionSlug),
          novelHomeUrl: normalizePathUrl(url.toString(), `/fiction/${fictionId}/${fictionSlug}`),
          lastReadChapterLabel:
            firstText([".chapter-title", ".fic-header h1", "h1"]) ||
            titleCaseFromSlug(chapterSlug),
          coverImageUrl:
            ogImage ||
            document.querySelector(".fiction-cover img, .thumbnail img")?.src ||
            ""
        };
      }
    }

    if (hostname === "patreon.com") {
      return {
        title:
          firstText(["[data-tag='post-title']", "h1"]) ||
          ogTitle ||
          "Patreon Post",
        novelHomeUrl: metaContent("og:url") || url.toString(),
        lastReadChapterLabel:
          firstText(["[data-tag='post-title']", "h1"]) ||
          ogTitle,
        coverImageUrl:
          ogImage ||
          document.querySelector("img")?.src ||
          ""
      };
    }

    if (hostname === "wuxiaworld.com") {
      const novelIndex = segments.indexOf("novel");
      if (novelIndex >= 0 && segments.length >= novelIndex + 2) {
        const novelSlug = segments[novelIndex + 1];
        return {
          title:
            firstText([".novel-title", ".book-info h1", "h1"]) ||
            titleCaseFromSlug(novelSlug),
          novelHomeUrl: normalizePathUrl(url.toString(), `/novel/${novelSlug}`),
          lastReadChapterLabel:
            firstText([".chapter-title", ".content-head h4", "h1"]) ||
            ogTitle,
          coverImageUrl:
            ogImage ||
            document.querySelector(".book-cover img, .novel-cover img")?.src ||
            ""
        };
      }
    }

    if (hostname === "novelbin.com") {
      const baseIndex = segments.indexOf("b");
      if (baseIndex >= 0 && segments.length >= baseIndex + 2) {
        const novelSlug = segments[baseIndex + 1];
        return {
          title:
            firstText([".info h3", ".book h3", ".truyen-title", "h1"]) ||
            titleCaseFromSlug(novelSlug),
          novelHomeUrl: normalizePathUrl(url.toString(), `/b/${novelSlug}`),
          lastReadChapterLabel:
            firstText([".chr-title", ".chapter-title", "h1", "h2"]) ||
            ogTitle,
          coverImageUrl:
            ogImage ||
            document.querySelector(".book img, .info img")?.src ||
            ""
        };
      }
    }

    return null;
  }

  function extractPageMetadata() {
    const canonicalHref = document.querySelector('link[rel="canonical"]')?.href || "";
    const pageUrl = window.location.href;
    const pageUrlObject = new URL(pageUrl);
    const ogTitle = cleanTitle(metaContent("og:title") || metaContent("twitter:title", "name"));
    const ogImage = metaContent("og:image");
    const pageTitle = cleanTitle(ogTitle || document.title || "");
    const heading = firstText(["h1", ".chapter-title", ".entry-title", ".post-title"]);
    const fallback = {
      title:
        metaContent("og:novel:title", "name") ||
        metaContent("twitter:title", "name") ||
        heading ||
        pageTitle ||
        "Untitled Novel",
      sourceSite: window.location.hostname.replace(/^www\./, ""),
      novelHomeUrl: canonicalHref || pageUrl,
      lastReadChapterUrl: pageUrl,
      lastReadChapterLabel:
        firstText([
          ".chapter-title",
          ".chr-title",
          ".reading-detail .title",
          "h1",
          "h2"
        ]) || pageTitle,
      coverImageUrl:
        ogImage ||
        document.querySelector('img[alt*="cover" i]')?.src ||
        ""
    };

    const specific = parseSiteSpecificMetadata(pageUrlObject, ogTitle, ogImage);
    return {
      ...fallback,
      ...specific,
      sourceSite: window.location.hostname.replace(/^www\./, ""),
      lastReadChapterUrl: pageUrl
    };
  }

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
    const payload = extractPageMetadata();

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
