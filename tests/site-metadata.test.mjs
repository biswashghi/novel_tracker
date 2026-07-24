import test from "node:test";
import assert from "node:assert/strict";

const { extractPageMetadataFromRoot } = await import("../src/lib/site-metadata.js");

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
