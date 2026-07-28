(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "novelbin",
    hostnames: ["novelbin.com"],
    parse({ core, root, segments, url, ogImage, ogTitle }) {
      const baseIndex = segments.indexOf("b");
      if (baseIndex < 0 || segments.length < baseIndex + 2) {
        return null;
      }

      const novelSlug = segments[baseIndex + 1];
      return {
        title:
          core.firstText(root, [".info h3", ".book h3", ".truyen-title", "h1"]) ||
          core.titleCaseFromSlug(novelSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/b/${novelSlug}`),
        lastReadChapterLabel:
          core.firstText(root, [".chr-title", ".chapter-title", "h1", "h2"]) ||
          ogTitle,
        coverImageUrl:
          ogImage ||
          root.querySelector(".book img, .info img")?.src ||
          ""
      };
    }
  });
})();
