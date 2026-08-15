import { getNovels, getHostname, normalizeUrl, upsertNovel } from "./lib/storage.js";
import { getExtensionApi } from "./lib/extension-api.js";

const extensionApi = getExtensionApi();

const PARSER_FILES = [
  "lib/parser-core.js",
  "lib/site-parsers/royalroad.js",
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

const fields = {
  title: document.querySelector("#title"),
  chapterLabel: document.querySelector("#chapter-label"),
  chapterUrl: document.querySelector("#chapter-url"),
  homeUrl: document.querySelector("#home-url"),
  coverUrl: document.querySelector("#cover-url"),
  status: document.querySelector("#status")
};

async function getActiveTab() {
  const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function readPageMetadata(tabId) {
  await extensionApi.scripting.executeScript({
    target: { tabId },
    files: PARSER_FILES
  });

  const [result] = await extensionApi.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.NovelTrackerPageMetadata.extractPageMetadata()
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
  extensionApi.runtime.openOptionsPage();
});

loadCurrentPage();
