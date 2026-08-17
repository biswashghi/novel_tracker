(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "scribblehub",
    hostnames: ["scribblehub.com"],
    parse({ core, root, hostname, segments, url, ogImage, ogTitle }) {
      if (segments[0] !== "read") {
        return null;
      }

      let seriesId = "";
      let seriesSlug = "";
      let chapterId = "";

      if (segments[2] === "chapter") {
        const match = segments[1]?.match(/^(\d+)-(.+)$/);
        seriesId = match?.[1] || "";
        seriesSlug = match?.[2] || segments[1];
        chapterId = segments[3];
      } else if (segments[3] === "chapter") {
        seriesId = segments[1];
        seriesSlug = segments[2];
        chapterId = segments[4];
      }

      if (!seriesSlug || !chapterId) {
        return null;
      }

      const chapterLabel = core.usefulText(
        core.firstText(root, [".chapter-title", ".entry-title", ".post-title", "h1"]) || ogTitle,
        hostname
      );

      return {
        title:
          core.usefulText(core.firstText(root, [".fic_title", ".series-title", ".breadcrumb a", ".breadcrumbs a"]), hostname) ||
          core.titleCaseFromSlug(seriesSlug),
        novelHomeUrl: seriesId
          ? core.normalizePathUrl(url.toString(), `/series/${seriesId}/${seriesSlug}/`)
          : core.normalizePathUrl(url.toString(), `/read/${seriesSlug}/`),
        lastReadChapterLabel: chapterLabel || `Chapter ${chapterId}`,
        coverImageUrl: core.pickCoverImage(root, ogImage, ".fic_image img, .series-cover img, img[alt*='cover' i]")
      };
    }
  });
})();
