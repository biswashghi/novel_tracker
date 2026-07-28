import test from "node:test";
import assert from "node:assert/strict";

const PARSER_FILES = [
  "../src/lib/parser-core.js",
  "../src/lib/site-parsers/royalroad.js",
  "../src/lib/site-parsers/patreon.js",
  "../src/lib/site-parsers/wuxiaworld.js",
  "../src/lib/site-parsers/novelbin.js",
  "../src/lib/site-parsers/scribblehub.js",
  "../src/lib/site-parsers/creativenovels.js",
  "../src/lib/site-parsers/lightnovelstranslations.js",
  "../src/lib/site-parsers/shintranslations.js",
  "../src/lib/page-metadata.js"
];

for (const file of PARSER_FILES) {
  await import(file);
}

const { extractPageMetadataFromRoot } = globalThis.NovelTrackerPageMetadata;

function createRoot({ title = "", selectors = {} }) {
  return {
    title,
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
