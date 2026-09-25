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

      // Only the work itself (/works/<id>, a one-shot or the first chapter)
      // and /works/<id>/chapters/<cid> are reading pages. The rest of the
      // work's pages (navigate, kudos, bookmarks, comments) still identify
      // the work for the popup, but must not move the bookmark.
      const rest = segments.slice(worksIndex + 2);
      const isChapterPage =
        rest.length === 0 || (rest.length === 2 && rest[0] === "chapters" && /^\d+$/.test(rest[1]));

      const workTitle = core.firstText(root, ["h2.title.heading", ".preface h2.title"]);
      const chapterTitle = core.firstText(root, ["#chapters .chapter.preface h3.title", ".chapter.preface h3.title"]);

      return {
        // The page title reads "<work> - Chapter N - <author> - <fandom> [Archive of Our Own]".
        title: workTitle || core.cleanTitle(String(root.title || "").split(" - ")[0]) || `Work ${workId}`,
        novelHomeUrl: core.normalizePathUrl(url.toString(), `/works/${workId}`),
        // One-shots have no chapter heading; the whole work is its only chapter.
        lastReadChapterLabel: chapterTitle || "Chapter 1",
        coverImageUrl: "",
        ...(isChapterPage ? {} : { isChapterPage: false })
      };
    }
  });
})();
