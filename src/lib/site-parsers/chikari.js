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

      const chapterHeading = core.firstText(root, [
        "[data-chapter-title]",
        ".chapter-title",
        ".reader-title",
        "main h2"
      ]);
      const pageTitle = core.stripSiteSuffix(ogTitle || root.title, "chikari.moe");
      const chapterFirstTitle = pageTitle.match(
        /^chapter\s+([^·|–—]+?)\s*[·|–—]\s*(.+)$/i
      );
      const titleFromPage = chapterFirstTitle?.[2]?.trim() || pageTitle
        .replace(/\s*[-–—|:]\s*chapter\s+\d+(?:\.\d+)?(?:\s+.*)?$/i, "")
        .trim();
      const chapterFromPage = chapterFirstTitle?.[1]?.trim();

      return {
        title:
          core.usefulText(core.firstText(root, ["[data-series-title]", ".series-title"]), "chikari.moe") ||
          core.usefulText(titleFromPage, "chikari.moe") ||
          core.titleCaseFromSlug(seriesSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/series/${seriesSlug}`),
        lastReadChapterLabel:
          core.usefulText(chapterHeading, "chikari.moe") ||
          (chapterFromPage ? `Chapter ${chapterFromPage}` : "") ||
          `Chapter ${chapterId}`,
        coverImageUrl: core.pickCoverImage(root, ogImage, "img[alt*='cover' i], img[alt*='Omniscient Reader' i]")
      };
    }
  });
})();
