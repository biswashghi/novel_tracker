(function () {
  NovelTrackerParserCore.registerSiteParser({
    id: "webnovel",
    hostnames: ["webnovel.com"],
    parse({ core, root, hostname, segments }) {
      // /book/<slug>_<bookId>/<chapterSlug>_<chapterId> (or just /<chapterId>);
      // the novel page is /book/<slug>_<bookId> and its list .../catalog.
      if (segments[0] !== "book" || segments.length < 2) {
        return null;
      }

      const bookSegment = segments[1];
      const bookSlug = bookSegment.replace(/_\d+$/, "");
      const homePath = `/book/${bookSegment}`;
      // The phone site (m.webnovel.com) serves the same books at the same
      // paths: file both under the www page so they stay one novel.
      const novelHomeUrl = `https://www.webnovel.com${homePath}`;
      if (segments.length < 3 || !/(^|_)\d+$/.test(segments[2])) {
        // Opening a tracked novel's own page must not move its bookmark there.
        return {
          title: core.titleCaseFromSlug(bookSlug),
          novelHomeUrl,
          coverImageUrl: "",
          isChapterPage: false
        };
      }
      const chapterId = segments[2].match(/(\d+)$/)?.[1] || "";

      // Both readers append following chapters as you scroll and switch the
      // URL and document title to the one in view, so read the heading of the
      // chapter the URL names, never the first one on the page. The desktop
      // reader wraps each chapter in [data-cid] with an <h1> like "Chapter
      // 883: 0881 Finished?"; the phone one puts just "0881 Finished?" next to
      // the chapter's #content-<id>, so its number comes from the document
      // title, "<Novel> Chapter 883 - 0881 Finished? - WebNovel" (which, unlike
      // the canonical link and og:title, follows the chapter in view).
      const pageTitle = String(root.title || "").replace(/\s+/g, " ").trim()
        .match(/^(.+?) Chapter (\d+) - (.+?)(?: - WebNovel)?$/i);
      const numbered = (name) => (pageTitle && name === pageTitle[3] ? `Chapter ${pageTitle[2]}: ${name}` : name);
      const phoneHeading = chapterId &&
        root.querySelector(`#content-${chapterId}`)?.parentElement?.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
      // Then the URL's own slug, and only for a bare /<chapterId> URL the
      // page's first heading. usefulText drops a bot-check page's
      // "www.webnovel.com" heading.
      const chapterSlug = segments[2].includes("_") ? core.titleCaseFromSlug(segments[2].replace(/_\d+$/, "")) : "";
      const chapterHeading = core.usefulText(
        (chapterId && core.firstText(root, [`[data-cid="${chapterId}"] h1`, `#chapter-${chapterId} h1`])) ||
          numbered(phoneHeading) ||
          numbered(pageTitle?.[3]) ||
          chapterSlug ||
          core.firstText(root, [".cha-tit h1", "h1"]),
        hostname
      );

      return {
        title:
          core.usefulText(core.firstText(root, [`a[href$="${homePath}"]`, ".cha-hd-mn-text a"]), hostname) ||
          pageTitle?.[1] ||
          core.titleCaseFromSlug(bookSlug),
        novelHomeUrl,
        lastReadChapterLabel: chapterHeading || core.titleCaseFromSlug(segments[2].replace(/_\d+$/, "")),
        coverImageUrl: ""
      };
    }
  });
})();
