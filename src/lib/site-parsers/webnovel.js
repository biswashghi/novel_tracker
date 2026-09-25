(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "webnovel",
    hostnames: ["webnovel.com"],
    parse({ core, root, hostname, segments, url }) {
      // /book/<slug>_<bookId>/<chapterSlug>_<chapterId> (or just /<chapterId>)
      if (segments[0] !== "book" || segments.length < 3) {
        return null;
      }

      const bookSegment = segments[1];
      const bookSlug = bookSegment.replace(/_\d+$/, "");
      const chapterId = segments[2].match(/(\d+)$/)?.[1] || "";
      const homePath = `/book/${bookSegment}`;

      // The reader appends following chapters as you scroll, so prefer the
      // heading inside the chapter the URL names over the first one on the page.
      // usefulText drops a bot-check page's "www.webnovel.com" heading.
      const chapterHeading = core.usefulText(
        (chapterId && core.firstText(root, [`[data-cid="${chapterId}"] h1`, `#chapter-${chapterId} h1`])) ||
          core.firstText(root, [".cha-tit h1", "h1"]),
        hostname
      );

      return {
        title:
          core.usefulText(core.firstText(root, [`a[href$="${homePath}"]`, ".cha-hd-mn-text a"]), hostname) ||
          core.titleCaseFromSlug(bookSlug),
        novelHomeUrl: core.normalizePathUrl(url.toString(), homePath),
        lastReadChapterLabel: chapterHeading || core.titleCaseFromSlug(segments[2].replace(/_\d+$/, "")),
        coverImageUrl: ""
      };
    }
  });
})();
