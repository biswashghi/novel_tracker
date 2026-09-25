import {
  buildSaveCandidate,
  findExistingNovelForSave,
  getNovels,
  getHostname
} from "./lib/storage.js";

import { getExtensionApi } from "./lib/extension-api.js";
import { PARSER_FILES } from "./lib/site-parser-files.js";

const extensionApi = getExtensionApi();

async function sendMessage(type, payload) {
  const result = await extensionApi.runtime.sendMessage({ type, payload });
  if (result?.error) throw new Error(result.error);
  return result;
}


const form = document.querySelector("#novel-form");
const sitePill = document.querySelector("#site-pill");
const statusMessage = document.querySelector("#status-message");
const saveButton = document.querySelector("#save-button");
const openLibraryButton = document.querySelector("#open-library");
const openLibraryFooterButton = document.querySelector("#open-library-footer");
const continueSection = document.querySelector("#continue-reading");
const continueList = document.querySelector("#continue-list");

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

function saveCandidate(source) {
  return { ...buildSaveCandidate(source), status: source.status || "active" };
}

/* =========================================================
   CONTINUE READING
========================================================= */

const CONTINUE_LIMIT = 3;

function relativeTime(value) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(value).toLocaleDateString();
}

function continueItem(novel) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "continue-item";
  button.title = novel.lastReadChapterUrl;

  const cover = document.createElement("span");
  cover.className = "continue-cover";
  cover.setAttribute("aria-hidden", "true");
  if (novel.coverImageUrl) {
    const image = document.createElement("img");
    image.src = novel.coverImageUrl;
    image.alt = "";
    // Fall back to initials when a cover fails to load.
    image.addEventListener("error", () => image.remove());
    cover.append(image);
  }
  cover.append(document.createTextNode((novel.title || "?").trim().charAt(0).toUpperCase()));

  const copy = document.createElement("span");
  copy.className = "continue-copy";
  const title = document.createElement("strong");
  title.textContent = novel.title;
  const detail = document.createElement("span");
  detail.textContent = [novel.lastReadChapterLabel || "Saved page", relativeTime(novel.updatedAt)]
    .filter(Boolean)
    .join(" · ");
  copy.append(title, detail);

  button.append(cover, copy, icon("chevron", "continue-arrow"));
  button.addEventListener("click", async () => {
    // tabs.create needs no permission; the popup closes once focus moves.
    await extensionApi.tabs.create({ url: novel.lastReadChapterUrl });
    window.close();
  });

  item.append(button);
  return item;
}

/**
 * The most recently read novels other than the one on this page, so the
 * popup doubles as a jump-back-in list when you are not on a chapter.
 */
function renderContinueReading(novels, currentNovelId = "") {
  const recent = novels
    .filter((novel) => novel.id !== currentNovelId && novel.lastReadChapterUrl?.startsWith("http"))
    .filter((novel) => novel.status !== "completed" && novel.status !== "dropped")
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
    .slice(0, CONTINUE_LIMIT);

  continueList.replaceChildren(...recent.map(continueItem));
  continueSection.hidden = recent.length === 0;
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

    existingNovel = findExistingNovelForSave(novels, saveCandidate(metadata)) || null;
    renderContinueReading(novels, existingNovel?.id);

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

    // The background service worker is the only writer; see background.js.
    const saved = await sendMessage("novel-tracker:library-upsert", saveCandidate({
      title: fields.title.value,
      novelHomeUrl: fields.homeUrl.value,
      lastReadChapterUrl: chapterUrl,
      lastReadChapterLabel: fields.chapterLabel.value,
      coverImageUrl: fields.coverUrl.value,
      status: fields.status.value
    }));

    // Adopt what was actually stored rather than re-deriving it: the save may
    // have merged into an entry that already existed under a different URL.
    existingNovel = saved?.id ? saved : existingNovel;

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

// Render the list straight away so it is there even when the current tab is
// not a readable page; loadCurrentPage refines it once it knows which novel
// (if any) this tab belongs to.
getNovels().then((novels) => renderContinueReading(novels)).catch(() => {});
loadCurrentPage();