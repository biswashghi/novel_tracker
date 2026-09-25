(function () {
  // Wuxiaworld's reader is styled with utility classes only, so anchor on
  // structure (the link back to the novel, the chapter content block) rather
  // than class names. A generic "h1" matched the "Related Novels" rail.
  function firstNonEmptyText(root, selector) {
    for (const node of root.querySelectorAll?.(selector) || []) {
      const text = node.textContent?.trim();
      if (text) return text;
    }
    return "";
  }

  NovelTrackerParserCore.registerSiteParser({
    id: "wuxiaworld",
    hostnames: ["wuxiaworld.com"],
    parse({ core, root, segments, url, ogImage, ogTitle }) {
      const novelIndex = segments.indexOf("novel");
      if (novelIndex < 0 || segments.length < novelIndex + 2) {
        return null;
      }

      const novelSlug = segments[novelIndex + 1];
      const homePath = `/novel/${novelSlug}`;
      // The document title reads "<novel> - <chapter>".
      const [titleNovel, ...titleChapter] = String(root.title || "").split(" - ");

      return {
        title:
          firstNonEmptyText(root, `a[href$="${homePath}"]`) ||
          core.firstText(root, [".novel-title", ".book-info h1"]) ||
          (titleChapter.length ? core.cleanTitle(titleNovel) : "") ||
          core.titleCaseFromSlug(novelSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), homePath),
        lastReadChapterLabel:
          core.firstText(root, ["[class*='-Chapter'] h4", ".chapter-title", ".content-head h4"]) ||
          titleChapter.join(" - ").trim() ||
          ogTitle,
        coverImageUrl: core.pickCoverImage(root, ogImage, "img[src*='/images/covers/'], .book-cover img, .novel-cover img")
      };
    }
  });
})();
