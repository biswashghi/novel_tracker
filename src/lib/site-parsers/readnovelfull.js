(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "readnovelfull",
    hostnames: ["readnovelfull.com"],
    parse({ core, root, segments, url, ogImage }) {
      // /<novel-slug>/chapter-<n>-<title>.html; the novel page is /<novel-slug>.html
      if (segments.length !== 2 || !segments[1].endsWith(".html")) {
        return null;
      }

      const novelSlug = segments[0];
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      return {
        title: clean(core.firstText(root, [".novel-title", "h1 a", "h1"])) || core.titleCaseFromSlug(novelSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/${novelSlug}.html`),
        // On narrow screens the visible text shortens "Chapter 1" to "C1";
        // the link's title attribute always carries the full label.
        lastReadChapterLabel:
          clean(root.querySelector(".chr-title")?.title) ||
          clean(core.firstText(root, [".chr-title", ".chr-text", "h2"])) ||
          core.titleCaseFromSlug(segments[1].replace(/\.html$/, "")),
        coverImageUrl: ogImage || ""
      };
    }
  });
})();
