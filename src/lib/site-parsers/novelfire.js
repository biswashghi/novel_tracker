(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "novelfire",
    hostnames: ["novelfire.net"],
    parse({ core, root, segments, url, ogImage }) {
      // /book/<slug>/chapter-<n>; the novel page is /book/<slug> and its
      // chapter list /book/<slug>/chapters.
      if (segments[0] !== "book" || segments.length < 2) {
        return null;
      }

      const novelSlug = segments[1];
      const title = core.firstText(root, [".booktitle", ".novel-title", "h1"]) || core.titleCaseFromSlug(novelSlug);
      if (segments.length < 3 || !/^chapter-/.test(segments[2])) {
        // Opening a tracked novel's own page must not move its bookmark there.
        return {
          title,
          novelHomeUrl: core.normalizePathUrl(url.toString(), `/book/${novelSlug}`),
          coverImageUrl: ogImage || "",
          isChapterPage: false
        };
      }

      return {
        title,
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/book/${novelSlug}`),
        lastReadChapterLabel:
          core.firstText(root, [".chapter-title"]) ||
          core.titleCaseFromSlug(segments[segments.length - 1]),
        coverImageUrl: ogImage || ""
      };
    }
  });
})();
