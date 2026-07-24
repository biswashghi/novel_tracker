import { getNovels, getHostname, normalizeUrl, upsertNovel } from "./lib/storage.js";

const form = document.querySelector("#novel-form");
const sitePill = document.querySelector("#site-pill");
const statusMessage = document.querySelector("#status-message");
const saveButton = document.querySelector("#save-button");
const openLibraryButton = document.querySelector("#open-library");

const fields = {
  title: document.querySelector("#title"),
  chapterLabel: document.querySelector("#chapter-label"),
  chapterUrl: document.querySelector("#chapter-url"),
  homeUrl: document.querySelector("#home-url"),
  coverUrl: document.querySelector("#cover-url"),
  status: document.querySelector("#status")
};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function readPageMetadata(tabId) {
  const injectedExtractor = () => {
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
          novelHomeUrl: metaContent(root, "og:url") || url.toString(),
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

    const pageUrl = window.location.href;
    const url = new URL(pageUrl);
    const canonicalHref = document.querySelector('link[rel="canonical"]')?.href || "";
    const pageTitle = cleanTitle(metaContent(document, "og:title") || document.title || "");
    const heading = firstText(document, ["h1", ".chapter-title", ".entry-title", ".post-title"]);
    const fallback = {
      title:
        metaContent(document, "og:novel:title", "name") ||
        metaContent(document, "twitter:title", "name") ||
        heading ||
        pageTitle ||
        "Untitled Novel",
      sourceSite: url.hostname.replace(/^www\./, ""),
      novelHomeUrl: canonicalHref || pageUrl,
      lastReadChapterUrl: pageUrl,
      lastReadChapterLabel:
        firstText(document, [".chapter-title", ".chr-title", ".reading-detail .title", "h1", "h2"]) ||
        pageTitle,
      coverImageUrl:
        metaContent(document, "og:image") ||
        document.querySelector('img[alt*="cover" i]')?.src ||
        ""
    };

    const specific = parseSiteSpecificMetadata(document, url);
    return {
      ...fallback,
      ...specific,
      sourceSite: url.hostname.replace(/^www\./, ""),
      lastReadChapterUrl: pageUrl
    };
  };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: injectedExtractor
  });

  return result?.result;
}

function setStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status${type ? ` ${type}` : ""}`;
}

function populateForm(data) {
  fields.title.value = data.title || "";
  fields.chapterLabel.value = data.lastReadChapterLabel || "";
  fields.chapterUrl.value = data.lastReadChapterUrl || "";
  fields.homeUrl.value = data.novelHomeUrl || "";
  fields.coverUrl.value = data.coverImageUrl || "";
  fields.status.value = data.status || "active";
  sitePill.textContent = data.sourceSite || "Unknown site";
}

async function loadCurrentPage() {
  try {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.startsWith("http")) {
      setStatus("Open a novel page in a normal browser tab to save progress.", "error");
      saveButton.disabled = true;
      return;
    }

    const metadata = await readPageMetadata(tab.id);
    if (!metadata?.lastReadChapterUrl) {
      throw new Error("Missing page metadata");
    }
    populateForm(metadata);

    const novels = await getNovels();
    const currentUrl = normalizeUrl(metadata.lastReadChapterUrl);
    const hostname = getHostname(metadata.lastReadChapterUrl);
    const existing = novels.find((novel) => {
      return (
        normalizeUrl(novel.lastReadChapterUrl) === currentUrl ||
        (novel.title.trim().toLowerCase() === metadata.title.trim().toLowerCase() &&
          novel.sourceSite === hostname)
      );
    });

    if (existing) {
      fields.status.value = existing.status || "active";
      fields.homeUrl.value = existing.novelHomeUrl || fields.homeUrl.value;
      fields.coverUrl.value = existing.coverImageUrl || fields.coverUrl.value;
      setStatus(`Existing entry found. Saving will update "${existing.title}".`);
    } else {
      setStatus("Ready to save this chapter.");
    }
  } catch (error) {
    console.error(error);
    setStatus("Could not read this page. Some sites block page inspection in extensions.", "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  setStatus("Saving...");

  try {
    await upsertNovel({
      title: fields.title.value,
      sourceSite: getHostname(fields.chapterUrl.value),
      novelHomeUrl: fields.homeUrl.value || fields.chapterUrl.value,
      lastReadChapterUrl: fields.chapterUrl.value,
      lastReadChapterLabel: fields.chapterLabel.value,
      coverImageUrl: fields.coverUrl.value,
      status: fields.status.value
    });

    setStatus("Progress saved.", "success");
  } catch (error) {
    console.error(error);
    setStatus("Unable to save this novel right now.", "error");
  } finally {
    saveButton.disabled = false;
  }
});

openLibraryButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadCurrentPage();
