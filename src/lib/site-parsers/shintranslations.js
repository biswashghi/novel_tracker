(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "shintranslations",
    hostnames: ["shintranslations.com"],
    parse({ core, root, hostname, url, ogImage, ogTitle }) {
      const fullTitle = core.stripSiteSuffix(ogTitle || root.title, "Shin Translations");
      const seriesTitle = core.stripChapterSuffix(fullTitle);

      if (!fullTitle || !/chapter|vol(?:ume)?\./i.test(fullTitle)) {
        return null;
      }

      return {
        title: seriesTitle || fullTitle,
        novelHomeUrl: url.origin,
        lastReadChapterLabel:
          core.usefulText(core.firstText(root, ["h1", ".entry-title", ".post-title"]), hostname) ||
          fullTitle,
        coverImageUrl: core.pickCoverImage(root, ogImage, ".post-thumbnail img, article img, img[alt*='cover' i]")
      };
    }
  });
})();
