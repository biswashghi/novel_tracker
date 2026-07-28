(function () {
  const parsers = new Map();

  function cleanTitle(title) {
    return String(title || "")
      .replace(/\s+/g, " ")
      .replace(/\s+[-|:]\s+[^-|:]+$/, "")
      .trim();
  }

  function firstText(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const value = node?.textContent?.trim();
      if (value) {
        return value;
      }
    }

    return "";
  }

  function metaContent(root, name, attr = "property") {
    return root.querySelector(`meta[${attr}="${name}"]`)?.content?.trim() || "";
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

  function titleCaseFromSlug(slug) {
    return String(slug || "")
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function usefulText(value, hostname) {
    const text = String(value || "").trim();
    const comparableText = text.toLowerCase().replace(/^www\./, "");
    if (!text || comparableText === hostname || /just a moment/i.test(text) || /bar menu/i.test(text)) {
      return "";
    }

    return text;
  }

  function splitNovelAndChapterTitle(title) {
    const value = String(title || "").replace(/\s+/g, " ").trim();
    const pipeParts = value.split(/\s+\|\s+/);
    if (pipeParts.length >= 2) {
      return {
        novelTitle: cleanTitle(pipeParts[0]),
        chapterLabel: cleanTitle(pipeParts.slice(1).join(" | "))
      };
    }

    return {
      novelTitle: "",
      chapterLabel: cleanTitle(value)
    };
  }

  function stripSiteSuffix(title, siteName) {
    return cleanTitle(String(title || "").replace(new RegExp(`\\s+[–-]\\s+${siteName}$`, "i"), ""));
  }

  function stripChapterSuffix(title) {
    return cleanTitle(
      String(title || "")
        .replace(/\s+(?:vol(?:ume)?\.?\s*\d+\s*)?chapter\s+\d+.*$/i, "")
        .replace(/\s+ch(?:apter)?\.?\s*\d+.*$/i, "")
    );
  }

  function registerSiteParser(parser) {
    if (!parser?.id || typeof parser.parse !== "function") {
      throw new Error("Site parser must include an id and parse function");
    }

    parsers.set(parser.id, parser);
  }

  function getSiteParsers() {
    return [...parsers.values()];
  }

  globalThis.NovelTrackerParserCore = {
    cleanTitle,
    firstText,
    getSiteParsers,
    metaContent,
    normalizePathUrl,
    registerSiteParser,
    splitNovelAndChapterTitle,
    stripChapterSuffix,
    stripSiteSuffix,
    titleCaseFromSlug,
    usefulText
  };
})();
