(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "wuxiaworld",
    hostnames: ["wuxiaworld.com"],
    parse({ core, root, segments, url, ogImage, ogTitle }) {
      const novelIndex = segments.indexOf("novel");
      if (novelIndex < 0 || segments.length < novelIndex + 2) {
        return null;
      }

      const novelSlug = segments[novelIndex + 1];
      return {
        title:
          core.firstText(root, [".novel-title", ".book-info h1", "h1"]) ||
          core.titleCaseFromSlug(novelSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/novel/${novelSlug}`),
        lastReadChapterLabel:
          core.firstText(root, [".chapter-title", ".content-head h4", "h1"]) ||
          ogTitle,
        coverImageUrl:
          ogImage ||
          root.querySelector(".book-cover img, .novel-cover img")?.src ||
          ""
      };
    }
  });
})();
