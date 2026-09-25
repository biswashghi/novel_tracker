(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "archiveofourown",
    hostnames: ["archiveofourown.org"],
    parse({ core, root, segments, url }) {
      // Works also live under collections: /collections/<name>/works/<id>/…
      const worksIndex = segments.indexOf("works");
      const workId = segments[worksIndex + 1];
      if (worksIndex < 0 || !/^\d+$/.test(workId || "")) {
        return null;
      }

      const workTitle = core.firstText(root, ["h2.title.heading", ".preface h2.title"]);
      const chapterTitle = core.firstText(root, ["#chapters .chapter.preface h3.title", ".chapter.preface h3.title"]);

      return {
        // The page title reads "<work> - Chapter N - <author> - <fandom> [Archive of Our Own]".
        title: workTitle || core.cleanTitle(String(root.title || "").split(" - ")[0]) || `Work ${workId}`,
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/works/${workId}`),
        // One-shots have no chapter heading; the whole work is its only chapter.
        lastReadChapterLabel: chapterTitle || "Chapter 1",
        coverImageUrl: ""
      };
    }
  });
})();
