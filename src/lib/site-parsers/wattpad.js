(function () {
  function storyIdFromCover(src) {
    return String(src || "").match(/\/cover\/(\d+)-/)?.[1] || "";
  }

  NovelTrackerParserCore.registerSiteParser({
    id: "wattpad",
    hostnames: ["wattpad.com"],
    parse({ core, root, segments, url }) {
      // Story parts live at /<partId>-<slug>; the story itself is /story/<id>-<slug>.
      if (segments[0] === "story" && segments[1]) {
        // The story's own page: identify it, but never move a bookmark to it.
        return {
          title: core.firstText(root, [".story-info__title", "h1"]) || core.cleanTitle(String(root.title || "").split(" - ")[0]),
          novelHomeUrl: core.normalizePathUrl(url.toString(), `/story/${segments[1]}`),
          isChapterPage: false
        };
      }

      const partMatch = segments.length === 1 ? segments[0].match(/^(\d+)(?:-(.*))?$/) : null;
      if (!partMatch) {
        return null;
      }

      const storyTitle = core.firstText(root, ["h2.title", ".story-info__title"]);
      const coverSrc = root.querySelector("img.cover")?.src || root.querySelector("img[src*='/cover/']")?.src || "";

      // The part URL carries no story id, so read it from the story link whose
      // text is the story title (the header also links unrelated stories).
      let novelHomeUrl = "";
      for (const link of root.querySelectorAll?.("a[href*='/story/']") || []) {
        if (storyTitle && link.textContent?.trim() === storyTitle) {
          novelHomeUrl = core.normalizePathUrl(link.href, new URL(link.href).pathname);
          break;
        }
      }
      if (!novelHomeUrl) {
        const storyId = storyIdFromCover(coverSrc);
        novelHomeUrl = storyId ? core.normalizePathUrl(url.toString(), `/story/${storyId}`) : "";
      }

      return {
        title: storyTitle || core.cleanTitle(String(root.title || "").split(" - ")[0]),
        novelHomeUrl: novelHomeUrl || url.toString(),
        lastReadChapterLabel:
          core.firstText(root, ["h1.h2", ".part-title", "h1"]) ||
          core.titleCaseFromSlug(partMatch[2] || ""),
        coverImageUrl: coverSrc
      };
    }
  });
})();
