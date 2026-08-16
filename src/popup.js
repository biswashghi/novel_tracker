import {
  getNovels,
  getHostname,
  normalizeUrl,
  upsertNovel
} from "./lib/storage.js";

import { getExtensionApi } from "./lib/extension-api.js";

const extensionApi = getExtensionApi();

const PARSER_FILES = [
  "lib/parser-core.js",
  "lib/site-parsers/royalroad.js",
  "lib/site-parsers/chikari.js",
  "lib/site-parsers/patreon.js",
  "lib/site-parsers/wuxiaworld.js",
  "lib/site-parsers/novelbin.js",
  "lib/site-parsers/scribblehub.js",
  "lib/site-parsers/creativenovels.js",
  "lib/site-parsers/lightnovelstranslations.js",
  "lib/site-parsers/shintranslations.js",
  "lib/page-metadata.js"
];

const form = document.querySelector("#novel-form");
const sitePill = document.querySelector("#site-pill");
const statusMessage = document.querySelector("#status-message");
const saveButton = document.querySelector("#save-button");
const openLibraryButton = document.querySelector("#open-library");
const openLibraryFooterButton = document.querySelector("#open-library-footer");

const fields = {
  title: document.querySelector("#title"),
  chapterLabel: document.querySelector("#chapter-label"),
  chapterUrl: document.querySelector("#chapter-url"),
  homeUrl: document.querySelector("#home-url"),
  coverUrl: document.querySelector("#cover-url"),
  status: document.querySelector("#status")
};

let existingNovel = null;

/* =========================================================
   DOM CHECK
========================================================= */

function assertRequiredDom() {
  const required = {
    form,
    sitePill,
    statusMessage,
    saveButton,
    openLibraryButton,
    ...fields
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(
      `Popup HTML is missing required elements: ${missing.join(", ")}`
    );
  }
}

assertRequiredDom();

/* =========================================================
   SVG
========================================================= */

function icon(name, className = "") {
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );

  svg.setAttribute("aria-hidden", "true");

  if (className) {
    svg.setAttribute("class", className);
  }

  const use = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "use"
  );

  use.setAttribute("href", `#i-${name}`);

  svg.append(use);

  return svg;
}

/* =========================================================
   TAB + METADATA
========================================================= */

async function getActiveTab() {
  const [tab] = await extensionApi.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

async function readPageMetadata(tabId) {
  await extensionApi.scripting.executeScript({
    target: { tabId },
    files: PARSER_FILES
  });

  const [result] = await extensionApi.scripting.executeScript({
    target: { tabId },
    func: () =>
      globalThis.NovelTrackerPageMetadata.extractPageMetadata()
  });

  return result?.result;
}

/* =========================================================
   UI HELPERS
========================================================= */

function setStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status${type ? ` ${type}` : ""}`;
}

function setSitePill(text, state = "") {
  sitePill.textContent = text;
  sitePill.className = `site-pill${state ? ` ${state}` : ""}`;
}

function setSaveButton({
  text,
  iconName = "bookmark",
  busy = false
}) {
  saveButton.replaceChildren();

  saveButton.append(
    icon(iconName, "save-button-icon"),
    document.createTextNode(text)
  );

  saveButton.disabled = busy;
  saveButton.classList.toggle("saving", busy);
}

function populateForm(data) {
  fields.title.value = data.title || "";
  fields.chapterLabel.value = data.lastReadChapterLabel || "";
  fields.chapterUrl.value = data.lastReadChapterUrl || "";
  fields.homeUrl.value = data.novelHomeUrl || "";
  fields.coverUrl.value = data.coverImageUrl || "";
  fields.status.value = data.status || "active";
}

/* =========================================================
   EXISTING NOVEL
========================================================= */

function findExistingNovel(novels, metadata) {
  const currentUrl = normalizeUrl(metadata.lastReadChapterUrl);
  const hostname = getHostname(metadata.lastReadChapterUrl);
  const normalizedTitle = metadata.title?.trim().toLowerCase();

  return (
    novels.find((novel) => {
      const sameChapter =
        normalizeUrl(novel.lastReadChapterUrl) === currentUrl;

      const sameNovel =
        novel.title?.trim().toLowerCase() === normalizedTitle &&
        novel.sourceSite === hostname;

      return sameChapter || sameNovel;
    }) || null
  );
}

/* =========================================================
   LOAD CURRENT PAGE
========================================================= */

async function loadCurrentPage() {
  setSitePill("Reading page…", "loading");
  setStatus("Looking for chapter information…");

  setSaveButton({
    text: "Reading page…",
    iconName: "spark",
    busy: true
  });

  try {
    const tab = await getActiveTab();

    if (!tab?.id || !tab.url?.startsWith("http")) {
      setSitePill("No novel page", "error");

      setStatus(
        "Open a novel chapter in a normal browser tab first.",
        "error"
      );

      setSaveButton({
        text: "Nothing to save",
        iconName: "bookmark",
        busy: true
      });

      return;
    }

    const metadata = await readPageMetadata(tab.id);

    if (!metadata?.lastReadChapterUrl) {
      throw new Error("Missing page metadata");
    }

    populateForm(metadata);

    const hostname = getHostname(metadata.lastReadChapterUrl);

    setSitePill(
      hostname || metadata.sourceSite || "Novel page",
      "ready"
    );

    const novels = await getNovels();

    existingNovel = findExistingNovel(novels, metadata);

    if (existingNovel) {
      fields.status.value =
        existingNovel.status || "active";

      fields.homeUrl.value =
        existingNovel.novelHomeUrl ||
        fields.homeUrl.value;

      fields.coverUrl.value =
        existingNovel.coverImageUrl ||
        fields.coverUrl.value;

      setStatus(
        `Already tracking "${existingNovel.title}". Saving will move your bookmark forward.`,
        "existing"
      );

      setSaveButton({
        text: "Update bookmark",
        iconName: "bookmark"
      });

      document.body.classList.add("existing-novel");
    } else {
      setStatus(
        "New novel detected. Save this chapter as your starting point.",
        "ready"
      );

      setSaveButton({
        text: "Save bookmark",
        iconName: "bookmark"
      });

      document.body.classList.remove("existing-novel");
    }
  } catch (error) {
    console.error("Unable to inspect page:", error);

    setSitePill("Page unavailable", "error");

    setStatus(
      "Could not read this page. The site may block extension page inspection.",
      "error"
    );

    setSaveButton({
      text: "Unable to save",
      iconName: "bookmark",
      busy: true
    });
  }
}

/* =========================================================
   SAVE
========================================================= */

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const wasExisting = Boolean(existingNovel);

  setSaveButton({
    text: wasExisting ? "Updating…" : "Saving…",
    iconName: "sync",
    busy: true
  });

  setStatus(
    wasExisting
      ? "Moving your bookmark…"
      : "Adding this novel to your library…"
  );

  try {
    const chapterUrl = fields.chapterUrl.value.trim();

    if (!chapterUrl) {
      throw new Error("Current page URL is required.");
    }

    await upsertNovel({
      title: fields.title.value.trim(),

      sourceSite: getHostname(chapterUrl),

      novelHomeUrl:
        fields.homeUrl.value.trim() ||
        chapterUrl,

      lastReadChapterUrl: chapterUrl,

      lastReadChapterLabel:
        fields.chapterLabel.value.trim(),

      coverImageUrl:
        fields.coverUrl.value.trim(),

      status:
        fields.status.value
    });

    existingNovel = {
      ...(existingNovel || {}),
      title: fields.title.value.trim(),
      sourceSite: getHostname(chapterUrl),
      novelHomeUrl:
        fields.homeUrl.value.trim() ||
        chapterUrl,
      lastReadChapterUrl: chapterUrl,
      lastReadChapterLabel:
        fields.chapterLabel.value.trim(),
      coverImageUrl:
        fields.coverUrl.value.trim(),
      status: fields.status.value
    };

    setStatus(
      wasExisting
        ? "Bookmark updated."
        : "Added to your library.",
      "success"
    );

    setSaveButton({
      text: "Saved",
      iconName: "check"
    });

    saveButton.classList.add("saved");

    window.setTimeout(() => {
      saveButton.classList.remove("saved");

      setSaveButton({
        text: "Update bookmark",
        iconName: "bookmark"
      });
    }, 1200);
  } catch (error) {
    console.error("Unable to save novel:", error);

    setStatus(
      error?.message ||
        "Unable to save this novel right now.",
      "error"
    );

    setSaveButton({
      text: wasExisting
        ? "Try update again"
        : "Try saving again",
      iconName: "bookmark"
    });
  }
});

/* =========================================================
   OPEN LIBRARY
========================================================= */

function openLibrary() {
  extensionApi.runtime.openOptionsPage();
}

openLibraryButton.addEventListener(
  "click",
  openLibrary
);

openLibraryFooterButton?.addEventListener(
  "click",
  openLibrary
);

/* =========================================================
   START
========================================================= */

loadCurrentPage();