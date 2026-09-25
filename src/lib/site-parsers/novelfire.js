(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "novelfire",
    hostnames: ["novelfire.net"],
    parse({ core, root, segments, url, ogImage }) {
      // /book/<slug>/chapter-<n>
      if (segments[0] !== "book" || segments.length < 3) {
        return null;
      }

      const novelSlug = segments[1];
      return {
        title: core.firstText(root, [".booktitle", ".novel-title"]) || core.titleCaseFromSlug(novelSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/book/${novelSlug}`),
        lastReadChapterLabel:
          core.firstText(root, [".chapter-title"]) ||
          core.titleCaseFromSlug(segments[segments.length - 1]),
        coverImageUrl: ogImage || ""
      };
    }
  });
})();
