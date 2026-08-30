(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "chikari",
    hostnames: ["chikari.moe"],
    parse({ core, root, segments, url, ogImage, ogTitle }) {
      const collection = segments[0];
      if ((collection !== "series" && collection !== "novels") || segments.length < 3) {
        return null;
      }

      const seriesSlug = segments[1];
      const chapterId = segments[2];
      if (!seriesSlug || !/^\d+(?:\.\d+)?$/.test(chapterId)) {
        return null;
      }

      const readerNovelTitle = collection === "novels"
        ? core.firstText(root, ['main header a[href^="/novels/"]'])
        : "";
      const chapterHeading = core.firstText(root, [
        "[data-chapter-title]",
        ".chapter-title",
        ".reader-title",
        ...(collection === "novels" ? ['main header a[href^="/novels/"] + p'] : [])
      ]);
      const pageTitle = core.cleanTitle(root.title || ogTitle)
        .replace(/\s*[·|–—-]\s*chikari\.moe$/i, "")
        .trim();
      const chapterFirstTitle = pageTitle.match(
        /^chapter\s+(.+?)\s+(?:·|\||–|—|-)\s+(.+)$/i
      );
      const titleFromPage = chapterFirstTitle?.[2]?.trim() || pageTitle
        .replace(/\s*[-–—|:]\s*chapter\s+\d+(?:\.\d+)?(?:\s+.*)?$/i, "")
        .trim();
      const chapterFromPage = chapterFirstTitle?.[1]?.trim();

      return {
        autoProgressReady: collection === "novels"
          ? Boolean(readerNovelTitle && chapterHeading)
          : Boolean(chapterFirstTitle),
        title:
          core.usefulText(readerNovelTitle, "chikari.moe") ||
          core.usefulText(core.firstText(root, ["[data-series-title]", ".series-title"]), "chikari.moe") ||
          core.usefulText(titleFromPage, "chikari.moe") ||
          core.titleCaseFromSlug(seriesSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/${collection}/${seriesSlug}`),
        lastReadChapterLabel:
          core.usefulText(chapterHeading, "chikari.moe") ||
          (chapterFromPage ? `Chapter ${chapterFromPage}` : "") ||
          `Chapter ${chapterId}`,
        coverImageUrl: core.pickCoverImage(root, ogImage, "img[alt*='cover' i], img[alt*='Omniscient Reader' i]")
      };
    }
  });
})();
