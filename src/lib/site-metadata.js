function cleanTitle(title) {
  return String(title || "")
    .replace(/\s+/g, " ")
    .replace(/\s+[-|:]\s+[^-|:]+$/, "")
    .trim();
}

function firstText(root, selectors) {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    const value = node?.textContent?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function metaContent(root, name, attr = "property") {
  return root.querySelector(`meta[${attr}="${name}"]`)?.content?.trim() || "";
}

function titleCaseFromSlug(slug) {
  return String(slug || "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizePathUrl(url, pathname) {
  try {
    const parsed = new URL(url);
    parsed.pathname = pathname;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseSiteSpecificMetadata(root, url) {
  const hostname = url.hostname.replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const ogTitle = cleanTitle(metaContent(root, "og:title") || metaContent(root, "twitter:title", "name"));
  const ogImage = metaContent(root, "og:image");

  if (hostname === "royalroad.com") {
    const fictionIndex = segments.indexOf("fiction");
    if (fictionIndex >= 0 && segments.length >= fictionIndex + 3) {
      const fictionId = segments[fictionIndex + 1];
      const fictionSlug = segments[fictionIndex + 2];
      const chapterSlug = segments[segments.length - 1];
      return {
        title:
          firstText(root, [".fic-title h1", ".font-white", "h1"]) ||
          titleCaseFromSlug(fictionSlug),
        novelHomeUrl: normalizePathUrl(url.toString(), `/fiction/${fictionId}/${fictionSlug}`),
        lastReadChapterLabel:
          firstText(root, [".chapter-title", ".fic-header h1", "h1"]) ||
          titleCaseFromSlug(chapterSlug),
        coverImageUrl:
          ogImage ||
          root.querySelector(".fiction-cover img, .thumbnail img")?.src ||
          ""
      };
    }
  }

  if (hostname === "patreon.com") {
    return {
      title:
        firstText(root, ["[data-tag='post-title']", "h1"]) ||
        ogTitle ||
        "Patreon Post",
      novelHomeUrl:
        metaContent(root, "og:url") ||
        url.toString(),
      lastReadChapterLabel:
        firstText(root, ["[data-tag='post-title']", "h1"]) ||
        ogTitle,
      coverImageUrl:
        ogImage ||
        root.querySelector("img")?.src ||
        ""
    };
  }

  if (hostname === "wuxiaworld.com") {
    const novelIndex = segments.indexOf("novel");
    if (novelIndex >= 0 && segments.length >= novelIndex + 2) {
      const novelSlug = segments[novelIndex + 1];
      return {
        title:
          firstText(root, [".novel-title", ".book-info h1", "h1"]) ||
          titleCaseFromSlug(novelSlug),
        novelHomeUrl: normalizePathUrl(url.toString(), `/novel/${novelSlug}`),
        lastReadChapterLabel:
          firstText(root, [".chapter-title", ".content-head h4", "h1"]) ||
          ogTitle,
        coverImageUrl:
          ogImage ||
          root.querySelector(".book-cover img, .novel-cover img")?.src ||
          ""
      };
    }
  }

  if (hostname === "novelbin.com") {
    const baseIndex = segments.indexOf("b");
    if (baseIndex >= 0 && segments.length >= baseIndex + 2) {
      const novelSlug = segments[baseIndex + 1];
      return {
        title:
          firstText(root, [".info h3", ".book h3", ".truyen-title", "h1"]) ||
          titleCaseFromSlug(novelSlug),
        novelHomeUrl: normalizePathUrl(url.toString(), `/b/${novelSlug}`),
        lastReadChapterLabel:
          firstText(root, [".chr-title", ".chapter-title", "h1", "h2"]) ||
          ogTitle,
        coverImageUrl:
          ogImage ||
          root.querySelector(".book img, .info img")?.src ||
          ""
      };
    }
  }

  return null;
}

export function extractPageMetadataFromRoot(root, pageUrl) {
  const url = new URL(pageUrl);
  const canonicalHref = root.querySelector('link[rel="canonical"]')?.href || "";
  const pageTitle = cleanTitle(metaContent(root, "og:title") || root.title || "");
  const heading = firstText(root, ["h1", ".chapter-title", ".entry-title", ".post-title"]);
  const fallback = {
    title:
      metaContent(root, "og:novel:title", "name") ||
      metaContent(root, "twitter:title", "name") ||
      heading ||
      pageTitle ||
      "Untitled Novel",
    sourceSite: url.hostname.replace(/^www\./, ""),
    novelHomeUrl: canonicalHref || pageUrl,
    lastReadChapterUrl: pageUrl,
    lastReadChapterLabel:
      firstText(root, [".chapter-title", ".chr-title", ".reading-detail .title", "h1", "h2"]) ||
      pageTitle,
    coverImageUrl:
      metaContent(root, "og:image") ||
      root.querySelector('img[alt*="cover" i]')?.src ||
      ""
  };

  const specific = parseSiteSpecificMetadata(root, url);
  return {
    ...fallback,
    ...specific,
    sourceSite: url.hostname.replace(/^www\./, ""),
    lastReadChapterUrl: pageUrl
  };
}

export function extractPageMetadata() {
  return extractPageMetadataFromRoot(document, window.location.href);
}
