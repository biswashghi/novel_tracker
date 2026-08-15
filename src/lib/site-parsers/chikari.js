(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "chikari",
    hostnames: ["chikari.moe"],
    parse({ core, root, segments, url, ogImage, ogTitle }) {
      if (segments[0] !== "series" || segments.length < 3) {
        return null;
      }

      const seriesSlug = segments[1];
      const chapterId = segments[2];
      if (!seriesSlug || !/^\d+(?:\.\d+)?$/.test(chapterId)) {
        return null;
      }

      const seriesLink = root.querySelector(`a[href='/series/${seriesSlug}'], a[href$='/series/${seriesSlug}']`);
      const chapterHeading = core.firstText(root, [
        "[data-chapter-title]",
        ".chapter-title",
        ".reader-title",
        "main h2"
      ]);
      const titleFromPage = core.stripSiteSuffix(ogTitle || root.title, "chikari.moe")
        .replace(/\s*[-–—|:]\s*chapter\s+\d+(?:\.\d+)?(?:\s+.*)?$/i, "")
        .trim();

      return {
        title:
          core.usefulText(seriesLink?.textContent, "chikari.moe") ||
          core.usefulText(core.firstText(root, ["[data-series-title]", ".series-title", "main h1"]), "chikari.moe") ||
          core.usefulText(titleFromPage, "chikari.moe") ||
          core.titleCaseFromSlug(seriesSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/series/${seriesSlug}`),
        lastReadChapterLabel:
          core.usefulText(chapterHeading, "chikari.moe") ||
          `Chapter ${chapterId}`,
        coverImageUrl:
          ogImage ||
          root.querySelector("img[alt*='cover' i], img[alt*='Omniscient Reader' i]")?.src ||
          ""
      };
    }
  });
})();
