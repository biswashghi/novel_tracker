(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "patreon",
    hostnames: ["patreon.com"],
    parse({ core, root, url, ogImage, ogTitle }) {
      return {
        title:
          core.firstText(root, ["[data-tag='post-title']", "h1"]) ||
          ogTitle ||
          "Patreon Post",
        novelHomeUrl:
          core.metaContent(root, "og:url") ||
          url.toString(),
        lastReadChapterLabel:
          core.firstText(root, ["[data-tag='post-title']", "h1"]) ||
          ogTitle,
        coverImageUrl: core.pickCoverImage(root, ogImage, "img")
      };
    }
  });
})();
