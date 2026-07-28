(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "creativenovels",
    hostnames: ["creativenovels.com"],
    parse({ core, root, hostname, segments, url, ogImage, ogTitle }) {
      if (segments.length < 2) {
        return null;
      }

      const titleParts = core.splitNovelAndChapterTitle(root.title || ogTitle);
      const chapterLabel = core.usefulText(core.firstText(root, ["h1", ".entry-title", ".chapter-title"]), hostname);
      const novelLink = root.querySelector(".breadcrumb a[href], .breadcrumbs a[href], a[href*='/novel/']")?.href;

      return {
        title:
          core.usefulText(titleParts.novelTitle, hostname) ||
          core.titleCaseFromSlug(segments[0]),
        novelHomeUrl: novelLink || core.normalizePathUrl(url.toString(), `/${segments[0]}/`),
        lastReadChapterLabel:
          chapterLabel ||
          core.stripSiteSuffix(titleParts.chapterLabel || ogTitle, "Creative Novels") ||
          core.titleCaseFromSlug(segments[1]),
        coverImageUrl: ogImage
      };
    }
  });
})();
