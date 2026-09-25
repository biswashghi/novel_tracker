(function () {
  // Current chapter URLs are /chapter/<abbr>-vol-<n>-chapter-<n>-part-<n>/ and
  // their titles only carry the series abbreviation ("TNG Vol. 22 …"). The
  // site menu links every series as /series/<full-slug>-<abbr>[-toc]/ with the
  // text "<Full Title> (<ABBR>)", so the abbreviation resolves the real series.
  function findSeriesLink(root, abbreviation) {
    const pattern = new RegExp(`-${abbreviation}(?:-toc)?/?$`, "i");
    for (const link of root.querySelectorAll?.("a[href*='/series/']") || []) {
      try {
        if (pattern.test(new URL(link.href).pathname)) return link;
      } catch {
        // Ignore malformed hrefs.
      }
    }
    return null;
  }

  NovelTrackerParserCore.registerSiteParser({
    id: "shintranslations",
    hostnames: ["shintranslations.com"],
    parse({ core, root, hostname, segments, url, ogImage, ogTitle }) {
      const fullTitle = core.stripSiteSuffix(ogTitle || root.title, "Shin Translations");
      const chapterLabel =
        core.usefulText(core.firstText(root, ["h1", ".entry-title", ".post-title"]), hostname) || fullTitle;
      const coverImageUrl = core.pickCoverImage(root, ogImage, ".post-thumbnail img, article img, img[alt*='cover' i]");

      if (segments[0] === "chapter" && segments[1]) {
        const abbreviation = segments[1].match(/^([a-z0-9]+)-(?:vol|chapter|ch)/i)?.[1] || "";
        const seriesLink = abbreviation ? findSeriesLink(root, abbreviation) : null;
        const seriesTitle = seriesLink?.textContent?.trim().replace(/\s*\([^)]*\)\s*$/, "") || "";
        return {
          title: seriesTitle || core.stripChapterSuffix(fullTitle) || fullTitle,
          novelHomeUrl: seriesLink ? core.normalizePathUrl(seriesLink.href, new URL(seriesLink.href).pathname) : url.origin,
          lastReadChapterLabel: chapterLabel,
          coverImageUrl
        };
      }

      // Older posts lived at the site root with the full series name in the title.
      const seriesTitle = core.stripChapterSuffix(fullTitle);
      if (!fullTitle || !/chapter|vol(?:ume)?\./i.test(fullTitle)) {
        return null;
      }

      return {
        title: seriesTitle || fullTitle,
        novelHomeUrl: url.origin,
        lastReadChapterLabel: chapterLabel,
        coverImageUrl
      };
    }
  });
})();
