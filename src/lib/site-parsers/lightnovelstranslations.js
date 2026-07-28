(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "lightnovelstranslations",
    hostnames: ["lightnovelstranslations.com"],
    parse({ core, root, hostname, segments, url, ogImage, ogTitle }) {
      if (segments[0] !== "novel" || segments.length < 3) {
        return null;
      }

      const novelSlug = segments[1];
      const chapterSlug = segments[segments.length - 1];
      const chapterLabel = core.usefulText(
        core.firstText(root, [".chapter-title", ".entry-title", "article h1"]) ||
          core.stripSiteSuffix(root.title || ogTitle, "Light Novels Translations"),
        hostname
      );

      return {
        title:
          core.usefulText(core.firstText(root, [".novel-title", ".book-title", ".post-title"]), hostname) ||
          core.titleCaseFromSlug(novelSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/novel/${novelSlug}/`),
        lastReadChapterLabel: chapterLabel || core.titleCaseFromSlug(chapterSlug),
        coverImageUrl:
          ogImage ||
          root.querySelector(".book-cover img, .novel-cover img, img[alt*='cover' i]")?.src ||
          ""
      };
    }
  });
})();
