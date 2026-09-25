import test from "node:test";
import assert from "node:assert/strict";

import { PARSER_FILES } from "../src/lib/site-parser-files.js";

for (const file of PARSER_FILES) {
  await import(`../src/${file}`);
}

const { extractPageMetadataFromRoot } = globalThis.NovelTrackerPageMetadata;

function createRoot({ title = "", selectors = {}, all = {} }) {
  return {
    title,
    querySelectorAll(selector) {
      return all[selector] || [];
    },
    querySelector(selector) {
      if (!(selector in selectors)) {
        return null;
      }

      const value = selectors[selector];
      if (value == null) {
        return null;
      }

      if (typeof value === "string") {
        return {
          textContent: value,
          content: value,
          href: value,
          src: value
        };
      }

      return value;
    }
  };
}

test("extractPageMetadataFromRoot uses Royal Road profile for fiction home URL", () => {
  const root = createRoot({
    title: "Chapter 384 - The Line",
    selectors: {
      ".fic-title h1": { textContent: "Elydes" },
      ".chapter-title": { textContent: "Chapter 384 - The Line" },
      ".fiction-cover img, .thumbnail img": { src: "https://img.example/elydes.jpg" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://www.royalroad.com/fiction/67742/elydes/chapter/3227191/chapter-384-the-line"
  );

  assert.equal(metadata.title, "Elydes");
  assert.equal(metadata.novelHomeUrl, "https://www.royalroad.com/fiction/67742/elydes");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 384 - The Line");
});

test("extractPageMetadataFromRoot does not use Royal Road chapter heading as novel title", () => {
  const root = createRoot({
    title: "Chapter 384 - The Line - Elydes | Royal Road",
    selectors: {
      "h1": { textContent: "Chapter 384 - The Line" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://www.royalroad.com/fiction/67742/elydes/chapter/3227191/chapter-384-the-line"
  );

  assert.equal(metadata.title, "Elydes");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 384 - The Line");
});

test("extractPageMetadataFromRoot uses Patreon profile for post title", () => {
  const root = createRoot({
    title: "Patreon post",
    selectors: {
      "[data-tag='post-title']": { textContent: "6.18 - Appendix [T3]" },
      'meta[property="og:url"]': { content: "https://www.patreon.com/posts/6-18-appendix-t3-157061502" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://www.patreon.com/posts/6-18-appendix-t3-157061502"
  );

  assert.equal(metadata.title, "6.18 - Appendix [T3]");
  assert.equal(metadata.lastReadChapterLabel, "6.18 - Appendix [T3]");
});

test("extractPageMetadataFromRoot uses Wuxiaworld profile for novel home URL", () => {
  const root = createRoot({
    title: "Chapter 12",
    selectors: {
      ".novel-title": { textContent: "A Practical Guide to Sorcery" },
      ".chapter-title": { textContent: "Chapter 12: Turning Point" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://www.wuxiaworld.com/novel/a-practical-guide-to-sorcery/chapter-12-turning-point"
  );

  assert.equal(metadata.title, "A Practical Guide to Sorcery");
  assert.equal(metadata.novelHomeUrl, "https://www.wuxiaworld.com/novel/a-practical-guide-to-sorcery");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 12: Turning Point");
});

test("extractPageMetadataFromRoot uses NovelBin profile for novel home URL", () => {
  const root = createRoot({
    title: "Chapter 101",
    selectors: {
      ".info h3": { textContent: "Shadow Slave" },
      ".chr-title": { textContent: "Chapter 101: Into the Dark" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://novelbin.com/b/shadow-slave/chapter-101-into-the-dark"
  );

  assert.equal(metadata.title, "Shadow Slave");
  assert.equal(metadata.novelHomeUrl, "https://novelbin.com/b/shadow-slave");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 101: Into the Dark");
});

test("extractPageMetadataFromRoot uses ScribbleHub URL shape when DOM is blocked", () => {
  const root = createRoot({
    title: "Just a moment...",
    selectors: {
      "h1": { textContent: "www.scribblehub.com" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://www.scribblehub.com/read/2291530-scarlet-steel/chapter/2470326/"
  );

  assert.equal(metadata.title, "Scarlet Steel");
  assert.equal(metadata.novelHomeUrl, "https://www.scribblehub.com/series/2291530/scarlet-steel/");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 2470326");
});

test("extractPageMetadataFromRoot uses Creative Novels title split", () => {
  const root = createRoot({
    title: "The Fractured Light | Chapter 1 — The Boy the World Forgot",
    selectors: {
      "h1": { textContent: "Chapter 1 — The Boy the World Forgot" },
      ".breadcrumb a[href], .breadcrumbs a[href], a[href*='/novel/']": {
        href: "https://creativenovels.com/302045/"
      }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://creativenovels.com/302045/chapter-1-the-boy-the-world-forgot/"
  );

  assert.equal(metadata.title, "The Fractured Light");
  assert.equal(metadata.novelHomeUrl, "https://creativenovels.com/302045/");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 1 — The Boy the World Forgot");
});

test("extractPageMetadataFromRoot uses Light Novels Translations URL shape and avoids nav headings", () => {
  const root = createRoot({
    title: "Chapter 364: Approaching The Seventh",
    selectors: {
      "h1": { textContent: "3 bar menu" },
      ".book-cover img, .novel-cover img, img[alt*='cover' i]": {
        src: "https://lightnovelstranslations.com/cover.jpg"
      }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://lightnovelstranslations.com/novel/i-became-a-living-cheat/chapter-364-approaching-the-seventh/"
  );

  assert.equal(metadata.title, "I Became A Living Cheat");
  assert.equal(metadata.novelHomeUrl, "https://lightnovelstranslations.com/novel/i-became-a-living-cheat/");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 364: Approaching The Seventh");
});

test("extractPageMetadataFromRoot uses Shin Translations chapter stripping", () => {
  const root = createRoot({
    title: "Starting a New Life for the Discarded All-Rounder Vol. 7 Chapter 26 Part 3 – Shin Translations",
    selectors: {
      "h1": {
        textContent: "Starting a New Life for the Discarded All-Rounder Vol. 7 Chapter 26 Part 3"
      },
      'meta[property="og:image"]': { content: "https://shintranslations.com/cover.png" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://shintranslations.com/starting-a-new-life-for-the-discarded-all-rounder-vol-7-chapter-26-part-3/"
  );

  assert.equal(metadata.title, "Starting a New Life for the Discarded All-Rounder");
  assert.equal(metadata.novelHomeUrl, "https://shintranslations.com");
  assert.equal(
    metadata.lastReadChapterLabel,
    "Starting a New Life for the Discarded All-Rounder Vol. 7 Chapter 26 Part 3"
  );
});

test("extractPageMetadataFromRoot maps Chikari chapters to their canonical series", () => {
  const root = createRoot({
    title: "Chapter 8 · Omniscient Reader",
    selectors: {
      'meta[property="og:image"]': { content: "https://cdn.chikari.moe/omniscient-reader.webp" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://chikari.moe/series/omniscient-reader/8"
  );

  assert.equal(metadata.title, "Omniscient Reader");
  assert.equal(metadata.novelHomeUrl, "https://chikari.moe/series/omniscient-reader");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 8");
  assert.equal(metadata.coverImageUrl, "https://cdn.chikari.moe/omniscient-reader.webp");
});

test("extractPageMetadataFromRoot supports Chikari novels reader routes", () => {
  const root = createRoot({
    title: "Chapter 2 — The Academy’s Weapon Replicator",
    selectors: {
      'main header a[href^="/novels/"]': { textContent: "The Academy’s Weapon Replicator" },
      'main header a[href^="/novels/"] + p': {
        textContent: "Chapter 1 (1) - The Academy's Weapon Replicator"
      },
      "main h2": { textContent: "Comments (4)" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://chikari.moe/novels/the-academys-weapon-replicator/2"
  );

  assert.equal(metadata.title, "The Academy’s Weapon Replicator");
  assert.equal(metadata.novelHomeUrl, "https://chikari.moe/novels/the-academys-weapon-replicator");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 1 (1) - The Academy's Weapon Replicator");
  assert.equal(metadata.autoProgressReady, true);
});

test("extractPageMetadataFromRoot marks an unhydrated Chikari novel reader as not ready", () => {
  const root = createRoot({
    title: "Chapter 2 — The Academy’s Weapon Replicator"
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://chikari.moe/novels/the-academys-weapon-replicator/2"
  );

  assert.equal(metadata.autoProgressReady, false);
});

test("extractPageMetadataFromRoot prefers Chikari's published chapter label over its numeric route id", () => {
  const root = createRoot({
    title: "Chapter 972 — The Academy’s Weapon Replicator",
    selectors: {
      'main header a[href^="/novels/"]': { textContent: "The Academy’s Weapon Replicator" },
      'main header a[href^="/novels/"] + p': { textContent: "Chapter 603: Salvation (2)" },
      "main h2": { textContent: "Comments" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://chikari.moe/novels/the-academys-weapon-replicator/972"
  );

  assert.equal(metadata.lastReadChapterLabel, "Chapter 603: Salvation (2)");
});

test("extractPageMetadataFromRoot strips Chikari's site suffix from series Open Graph titles", () => {
  const root = createRoot({
    selectors: {
      'meta[property="og:title"]': { content: "Chapter 304 · Omniscient Reader · chikari.moe" },
      "main h2": { textContent: "Comments (1)" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://chikari.moe/series/omniscient-reader/304"
  );

  assert.equal(metadata.title, "Omniscient Reader");
  assert.equal(metadata.novelHomeUrl, "https://chikari.moe/series/omniscient-reader");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 304");
  assert.equal(metadata.autoProgressReady, true);
});

test("extractPageMetadataFromRoot reads Wuxiaworld's utility-class reader layout", () => {
  const root = createRoot({
    title: "Coiling Dragon - Book 1, Chapter 1 – Early Morning at a Township",
    selectors: {
      "h1": { textContent: "Related Novels" },
      "[class*='-Chapter'] h4": { textContent: "Book 1, Chapter 1 – Early Morning at a Township" }
    },
    all: {
      'a[href$="/novel/coiling-dragon"]': [{ textContent: "" }, { textContent: "Coiling Dragon" }]
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://www.wuxiaworld.com/novel/coiling-dragon/cd-book-1-chapter-1"
  );

  assert.equal(metadata.title, "Coiling Dragon");
  assert.equal(metadata.novelHomeUrl, "https://www.wuxiaworld.com/novel/coiling-dragon");
  assert.equal(metadata.lastReadChapterLabel, "Book 1, Chapter 1 – Early Morning at a Township");
});

test("extractPageMetadataFromRoot falls back to Wuxiaworld's document title", () => {
  const root = createRoot({ title: "Renegade Immortal - Chapter 1 – Leaving Home" });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-1"
  );

  assert.equal(metadata.title, "Renegade Immortal");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 1 – Leaving Home");
});

test("extractPageMetadataFromRoot resolves Shin Translations abbreviations to their series", () => {
  const root = createRoot({
    title: "TNG Vol. 22 Chapter 4 Part 2 – Shin Translations",
    selectors: { "h1": { textContent: "TNG Vol. 22 Chapter 4 Part 2" } },
    all: {
      "a[href*='/series/']": [
        { href: "https://shintranslations.com/series/", textContent: "Series" },
        {
          href: "https://shintranslations.com/series/starting-a-new-life-for-the-discarded-all-rounder-dar/",
          textContent: "Starting a New Life for the Discarded All-Rounder (DAR)"
        },
        { href: "https://shintranslations.com/series/the-new-gate-tng-toc/", textContent: "THE NEW GATE (TNG)" }
      ]
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://shintranslations.com/chapter/tng-vol-22-chapter-4-part-2/"
  );

  assert.equal(metadata.title, "THE NEW GATE");
  assert.equal(metadata.novelHomeUrl, "https://shintranslations.com/series/the-new-gate-tng-toc/");
  assert.equal(metadata.lastReadChapterLabel, "TNG Vol. 22 Chapter 4 Part 2");
});

test("extractPageMetadataFromRoot uses the Archive of Our Own work and chapter headings", () => {
  const root = createRoot({
    title: "Evitative - Chapter 1 - Vichan - Harry Potter - J. K. Rowling [Archive of Our Own]",
    selectors: {
      "h2.title.heading": { textContent: "Evitative" },
      "#chapters .chapter.preface h3.title": { textContent: "Chapter 1: The Library" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://archiveofourown.org/works/20049589/chapters/47480461?view_adult=true"
  );

  assert.equal(metadata.title, "Evitative");
  assert.equal(metadata.novelHomeUrl, "https://archiveofourown.org/works/20049589");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 1: The Library");
});

test("extractPageMetadataFromRoot treats an Archive of Our Own one-shot as chapter 1", () => {
  const root = createRoot({
    title: "Small Work - isthisselfcare [Archive of Our Own]",
    selectors: { "h2.title.heading": { textContent: "Small Work" } }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://archiveofourown.org/collections/fest/works/123456"
  );

  assert.equal(metadata.title, "Small Work");
  assert.equal(metadata.novelHomeUrl, "https://archiveofourown.org/works/123456");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 1");
});

test("extractPageMetadataFromRoot finds the Wattpad story from its title link", () => {
  const root = createRoot({
    title: "Empire of Ashes - Preview - Wattpad",
    selectors: {
      "h2.title": { textContent: "Empire of Ashes" },
      "h1.h2": { textContent: "Preview" },
      "img.cover": { src: "https://img.wattpad.com/cover/66766637-288-k635916.jpg" }
    },
    all: {
      "a[href*='/story/']": [
        { href: "https://www.wattpad.com/story/25279524", textContent: "Community Happenings" },
        { href: "https://www.wattpad.com/story/66766637-empire-of-ashes?ref=nav", textContent: "Empire of Ashes" }
      ]
    }
  });

  const metadata = extractPageMetadataFromRoot(root, "https://www.wattpad.com/235603347-empire-of-ashes-preview");

  assert.equal(metadata.title, "Empire of Ashes");
  assert.equal(metadata.novelHomeUrl, "https://www.wattpad.com/story/66766637-empire-of-ashes");
  assert.equal(metadata.lastReadChapterLabel, "Preview");
  assert.equal(metadata.coverImageUrl, "https://img.wattpad.com/cover/66766637-288-k635916.jpg");
});

test("extractPageMetadataFromRoot falls back to the Wattpad cover's story id", () => {
  const root = createRoot({
    selectors: {
      "h2.title": { textContent: "Empire of Ashes" },
      "img[src*='/cover/']": { src: "https://img.wattpad.com/cover/66766637-64-k635916.jpg" }
    }
  });

  const metadata = extractPageMetadataFromRoot(root, "https://www.wattpad.com/235603347-empire-of-ashes-preview");

  assert.equal(metadata.novelHomeUrl, "https://www.wattpad.com/story/66766637");
});

test("extractPageMetadataFromRoot reads the Webnovel chapter the URL names", () => {
  const root = createRoot({
    title: "Shadow Slave Chapter 1 - Nightmare Begins - WebNovel",
    selectors: {
      'a[href$="/book/shadow-slave_22196546206090805"]': { textContent: "Shadow Slave" },
      '[data-cid="59583457017254387"] h1': { textContent: "Chapter 1: Nightmare Begins" },
      ".cha-tit h1": { textContent: "Chapter 0: Earlier Chapter Still In The Page" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://www.webnovel.com/book/shadow-slave_22196546206090805/nightmare-begins_59583457017254387"
  );

  assert.equal(metadata.title, "Shadow Slave");
  assert.equal(metadata.novelHomeUrl, "https://www.webnovel.com/book/shadow-slave_22196546206090805");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 1: Nightmare Begins");
});

test("extractPageMetadataFromRoot uses the NovelFire book link and chapter title", () => {
  const root = createRoot({
    selectors: {
      ".booktitle": { textContent: "Lord of the Mysteries" },
      ".chapter-title": { textContent: "Chapter 1 - Crimson" },
      'meta[property="og:image"]': { content: "https://novelfire.net/server-1/lord-of-the-mysteries.jpg" }
    }
  });

  const metadata = extractPageMetadataFromRoot(root, "https://novelfire.net/book/lord-of-the-mysteries/chapter-1");

  assert.equal(metadata.title, "Lord of the Mysteries");
  assert.equal(metadata.novelHomeUrl, "https://novelfire.net/book/lord-of-the-mysteries");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 1 - Crimson");
  assert.equal(metadata.coverImageUrl, "https://novelfire.net/server-1/lord-of-the-mysteries.jpg");
});

test("extractPageMetadataFromRoot maps ReadNovelFull chapters to the novel's .html page", () => {
  const root = createRoot({
    selectors: {
      ".novel-title": { textContent: "Second World" },
      // What a phone-width page serves: abbreviated text, full title attribute.
      ".chr-title": { textContent: "C1 - 1.  Beta Test", title: "Chapter 1 - 1.  Beta Test" }
    }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://readnovelfull.com/second-world/chapter-1-1-beta-test.html"
  );

  assert.equal(metadata.title, "Second World");
  assert.equal(metadata.novelHomeUrl, "https://readnovelfull.com/second-world.html");
  assert.equal(metadata.lastReadChapterLabel, "Chapter 1 - 1. Beta Test");
});

test("extractPageMetadataFromRoot ignores a Webnovel bot-check page's heading", () => {
  const root = createRoot({
    title: "Just a moment...",
    selectors: { "h1": { textContent: "www.webnovel.com" } }
  });

  const metadata = extractPageMetadataFromRoot(
    root,
    "https://www.webnovel.com/book/supreme-magus_12820870105509205/a-new-beginning_34415834751367671"
  );

  assert.equal(metadata.title, "Supreme Magus");
  assert.equal(metadata.lastReadChapterLabel, "A New Beginning");
});

test("extractPageMetadataFromRoot marks Archive of Our Own work pages that are not chapters", () => {
  const root = createRoot({ selectors: { "h2.title.heading": { textContent: "All the Young Dudes" } } });

  for (const path of ["navigate", "kudos", "bookmarks", "comments"]) {
    const metadata = extractPageMetadataFromRoot(root, `https://archiveofourown.org/works/10057010/${path}`);
    assert.equal(metadata.isChapterPage, false, path);
    assert.equal(metadata.novelHomeUrl, "https://archiveofourown.org/works/10057010");
  }

  for (const url of [
    "https://archiveofourown.org/works/10057010",
    "https://archiveofourown.org/works/10057010/chapters/22409387"
  ]) {
    assert.equal(extractPageMetadataFromRoot(root, url).isChapterPage, undefined, url);
  }
});
