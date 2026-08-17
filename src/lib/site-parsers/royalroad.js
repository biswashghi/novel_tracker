(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "royalroad",
    hostnames: ["royalroad.com"],
    parse({ core, root, segments, url, ogImage }) {
      const fictionIndex = segments.indexOf("fiction");
      if (fictionIndex < 0 || segments.length < fictionIndex + 3) {
        return null;
      }

      const fictionId = segments[fictionIndex + 1];
      const fictionSlug = segments[fictionIndex + 2];
      const chapterSlug = segments[segments.length - 1];

      return {
        title:
          core.firstText(root, [".fic-title h1", ".font-white"]) ||
          core.titleCaseFromSlug(fictionSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/fiction/${fictionId}/${fictionSlug}`),
        lastReadChapterLabel:
          core.firstText(root, [".chapter-title", ".fic-header h1", "h1"]) ||
          core.titleCaseFromSlug(chapterSlug),
        coverImageUrl: core.pickCoverImage(root, ogImage, ".fiction-cover img, .thumbnail img")
      };
    }
  });
})();
