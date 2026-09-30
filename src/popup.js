import {
  buildSaveCandidate,
  findExistingNovelForSave,
  getNovels,
  getHostname
} from "./lib/storage.js";

import { getExtensionApi, getStorageLocal, isSafariExtension } from "./lib/extension-api.js";
import { PARSER_FILES } from "./lib/site-parser-files.js";
import { isAutoTrackedUrl } from "./lib/supported-sites.js";

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
const continueCount = document.querySelector("#continue-count");

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
   AFTER-SAVE GUIDANCE
========================================================= */

// Per-browser, never synced: it records what this install has already told
// the reader, not anything about their library.
const ONBOARDING_KEY = "novel-tracker:onboarding";

async function readOnboarding() {
  try {
    return (await getStorageLocal()?.get(ONBOARDING_KEY))?.[ONBOARDING_KEY] || {};
  } catch {
    return {};
  }
}

async function markOnboarding(patch) {
  try {
    await getStorageLocal()?.set({ [ONBOARDING_KEY]: { ...(await readOnboarding()), ...patch } });
  } catch {
    // Worst case the reader sees the explanation once more.
  }
}

/**
 * What to say after a save. Readers otherwise assume they have to come back
 * and save every chapter by hand, which is the chore this extension exists
 * to remove, so the first save on a followed site says that it's automatic
 * from here. On a site the content script doesn't run on, every save says
 * the opposite, because there it's true every time.
 */
async function savedMessage(chapterUrl, wasExisting) {
  const saved = wasExisting ? "Bookmark updated." : "Added to your library.";
  const autoTracked = isAutoTrackedUrl(chapterUrl);
  const site = getHostname(chapterUrl) || "this site";

  if (autoTracked === false) {
    return {
      text: `${saved} ${site} isn't followed automatically, so save here again when you move on to a new chapter.`,
      type: "manual"
    };
  }

  if (autoTracked && !(await readOnboarding()).autoTrackExplained) {
    await markOnboarding({ autoTrackExplained: true });
    return {
      text: `${saved} From here on, just keep reading: your place updates by itself each time you open a new chapter on ${site}.`,
      type: "tracking"
    };
  }

  return { text: saved, type: "success" };
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

function isWebUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function continueItem(novel) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "continue-item";

  const cover = document.createElement("span");
  cover.className = "continue-cover";
  cover.setAttribute("aria-hidden", "true");
  if (novel.coverImageUrl) {
    const image = document.createElement("img");
    // Covers are remote; don't tell their hosts which extension asked.
    image.referrerPolicy = "no-referrer";
    image.loading = "lazy";
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
    button.disabled = true;
    try {
      // tabs.create needs no permission; the popup closes once focus moves.
      await extensionApi.tabs.create({ url: novel.lastReadChapterUrl });
      window.close();
    } catch (error) {
      console.error("Unable to open chapter:", error);
      setStatus(`Could not open "${novel.title}".`, "error");
      button.disabled = false;
    }
  });

  item.append(button);
  return item;
}

/**
 * The most recently read novels other than the one on this page.
 *
 * Chrome cuts popups off at 600px, so the list has to share that height
 * with the save form. On a page the popup cannot read, the form is useless:
 * it collapses (body.no-page) and the list opens. On a chapter, the list
 * stays a one-line disclosure under the form.
 */
async function showContinueReading({ pageReadable, currentNovelId = "" }) {
  document.body.classList.toggle("no-page", !pageReadable);

  let novels = [];
  try {
    novels = await getNovels();
  } catch (error) {
    console.error("Unable to load recent novels:", error);
  }

  const recent = novels
    .filter((novel) => novel.id !== currentNovelId && isWebUrl(novel.lastReadChapterUrl))
    .filter((novel) => novel.status !== "completed" && novel.status !== "dropped")
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
    .slice(0, CONTINUE_LIMIT);

  continueList.replaceChildren(...recent.map(continueItem));
  continueCount.textContent = recent.length ? String(recent.length) : "";
  continueSection.open = !pageReadable;
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

      await showContinueReading({ pageReadable: false });
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
    showContinueReading({ pageReadable: true, currentNovelId: existingNovel?.id });

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

    // On Safari the usual cause is a site permission the reader hasn't given
    // (or gave only "for one day"), which they can fix; elsewhere it's a page
    // that doesn't let extensions in at all.
    setStatus(
      isSafariExtension()
        ? "Novel Tracker isn't allowed to read this page yet. Close this, open Novel Tracker from Safari again, and choose Always Allow for this website."
        : "Novel Tracker can't read this page. Some sites and browser pages don't let extensions in.",
      "error"
    );

    setSaveButton({
      text: "Unable to save",
      iconName: "bookmark",
      busy: true
    });

    await showContinueReading({ pageReadable: false });
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

    const message = await savedMessage(chapterUrl, wasExisting);
    setStatus(message.text, message.type);

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