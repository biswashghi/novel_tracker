(function () {
  function createParseContext(root, pageUrl) {
    const core = globalThis.NovelTrackerParserCore;
    const docRoot = root && typeof root.querySelector === "function" ? root : document;
    const pageUrlValue = pageUrl || (typeof window !== "undefined" ? window.location.href : "");
    const url = new URL(pageUrlValue);
    const hostname = url.hostname.replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    const ogTitle = core.cleanTitle(
      core.metaContent(docRoot, "og:title") ||
        core.metaContent(docRoot, "twitter:title", "name")
    );

    return {
      root: docRoot,
      pageUrl: pageUrlValue,
      url,
      hostname,
      segments,
      canonicalHref: docRoot.querySelector('link[rel="canonical"]')?.href || "",
      ogImage: core.metaContent(docRoot, "og:image"),
      ogTitle,
      pageTitle: core.cleanTitle(ogTitle || docRoot.title || ""),
      core
    };
  }

  function createFallbackMetadata(context) {
    const { core, root, hostname, pageTitle, canonicalHref, pageUrl } = context;
    const heading = core.firstText(root, ["h1", ".chapter-title", ".entry-title", ".post-title"]);

    return {
      title:
        core.metaContent(root, "og:novel:title", "name") ||
        core.metaContent(root, "twitter:title", "name") ||
        heading ||
        pageTitle ||
        "Untitled Novel",
      sourceSite: hostname,
      novelHomeUrl: canonicalHref || pageUrl,
      lastReadChapterUrl: pageUrl,
      lastReadChapterLabel:
        core.firstText(root, [".chapter-title", ".chr-title", ".reading-detail .title", "h1", "h2"]) ||
        pageTitle,
      coverImageUrl:
        core.metaContent(root, "og:image") ||
        root.querySelector('img[alt*="cover" i]')?.src ||
        ""
    };
  }

  function extractPageMetadataFromRoot(root, pageUrl) {
    const context = createParseContext(root, pageUrl);
    const fallback = createFallbackMetadata(context);
    const parser = context.core.getSiteParsers().find((candidate) => {
      return !candidate.hostnames || candidate.hostnames.includes(context.hostname);
    });
    const specific = parser?.parse(context) || null;

    return {
      ...fallback,
      ...specific,
      sourceSite: context.hostname,
      lastReadChapterUrl: context.pageUrl
    };
  }

  function extractPageMetadata() {
    return extractPageMetadataFromRoot(document, window.location.href);
  }

  globalThis.NovelTrackerPageMetadata = {
    extractPageMetadata,
    extractPageMetadataFromRoot
  };
})();
