// Reads only. Every mutation goes through the background service worker so
// there is exactly one writer for the sync blob (see background.js).
import {
  exportNovelsJson,
  getLibraryView,
  normalizeTags
} from "./lib/storage.js";

import { computeReadingHeatmap, computeReadingStats } from "./lib/reading-stats.js";
import { novelsToCsv } from "./lib/csv.js";
import { SORT_MODES, sortNovels } from "./lib/library-sort.js";

import { getExtensionApi } from "./lib/extension-api.js";
import { requireFirefoxSyncDataConsent } from "./lib/firefox-data-consent.js";

import { AUTH_PROVIDERS } from "./lib/config.js";

const library = document.querySelector("#library");
const trash = document.querySelector("#trash");
const trashSummary = document.querySelector("#trash-summary");
const trashList = document.querySelector("#trash-list");
const toast = document.querySelector("#toast");

const searchInput = document.querySelector("#search");
const statusFilter = document.querySelector("#status-filter");
const tagFilter = document.querySelector("#tag-filter");
const sortSelect = document.querySelector("#sort");

const statStreak = document.querySelector("#stat-streak");
const statWeek = document.querySelector("#stat-week");
const statMonth = document.querySelector("#stat-month");
const statCompleted = document.querySelector("#stat-completed");
const statTotal = document.querySelector("#stat-total");

const activity = document.querySelector("#reading-activity");
const activitySummary = document.querySelector("#activity-summary");
const activityGrid = document.querySelector("#activity-grid");

const exportJsonButton = document.querySelector("#export-json");
const exportCsvButton = document.querySelector("#export-csv");
const importJsonButton = document.querySelector("#import-json");
const importFileInput = document.querySelector("#import-file");

const accountTitle = document.querySelector("#account-title");
const syncDetail = document.querySelector("#sync-detail");
const syncIndicator = document.querySelector("#sync-indicator");

const signInActions = document.querySelector("#sign-in-actions");
const signOutButton = document.querySelector("#sign-out");
const syncNowButton = document.querySelector("#sync-now");
const deleteAccountButton = document.querySelector("#delete-account");

let novels = [];
let animateEntrance = true;

/* =========================================================
   SVG HELPERS
========================================================= */

function icon(name, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (className) svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");

  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

/* =========================================================
   EXTENSION MESSAGING
========================================================= */

async function sendMessage(type, payload) {
  const result = await getExtensionApi().runtime.sendMessage({ type, payload });
  if (result?.error) throw new Error(result.error);
  return result;
}

/* =========================================================
   ACCOUNT
========================================================= */

function setVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.classList.toggle("is-hidden", !visible);
}

function providerName(providerId) {
  const provider = AUTH_PROVIDERS.find((candidate) => candidate.id === providerId);
  // Labels read "Sign in with Google"; the bare name is what reads well mid-sentence.
  return provider ? provider.label.replace(/^Sign in with\s+/i, "") : "";
}

function renderAccount(snapshot) {
  const account = snapshot?.account || {};
  const sync = snapshot?.sync || {};
  const signedIn = Boolean(account.signedIn);

  // Signed out: only the sign-in buttons are shown. Signed in: Sync / Sign out / Delete.
  setVisible(signInActions, !signedIn);
  setVisible(syncNowButton, signedIn);
  setVisible(signOutButton, signedIn);
  setVisible(deleteAccountButton, signedIn);

  syncIndicator?.classList.remove("syncing", "error", "signed-out");

  if (signedIn) {
    accountTitle.textContent = account.name || account.email || "Novel Tracker account";
  } else {
    accountTitle.textContent = "Stored locally";
    syncIndicator?.classList.add("signed-out");
  }

  if (!signedIn) {
    syncDetail.textContent = "No account required";
  } else if (sync.state === "syncing") {
    syncDetail.textContent = "Synchronizing…";
    syncIndicator?.classList.add("syncing");
  } else if (sync.state === "error") {
    syncDetail.textContent = sync.lastError ? `Sync paused · ${sync.lastError}` : "Sync paused";
    syncIndicator?.classList.add("error");
  } else if (sync.lastError) {
    // Synced, but the server refused some changes (e.g. schema drift).
    syncDetail.textContent = `Synced ${formatRelativeDate(sync.lastSyncedAt)} · ${sync.lastError}`;
    syncIndicator?.classList.add("error");
  } else if (sync.lastSyncedAt) {
    syncDetail.textContent = `Synced ${formatRelativeDate(sync.lastSyncedAt)}`;
  } else {
    syncDetail.textContent = "Ready to sync";
  }
}

async function refreshAccount() {
  try {
    renderAccount(await sendMessage("novel-tracker:account-status"));
  } catch (error) {
    syncDetail.textContent = error.message;
    syncIndicator.classList.add("error");
  }
}

async function withBusy(button, operation) {
  button.disabled = true;
  button.classList.add("busy");

  try {
    return await operation();
  } catch (error) {
    window.alert(error.message || "The account request failed.");
    return null;
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
  }
}

/* =========================================================
   DATE FORMATTING
========================================================= */

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "Unknown time";
  }
}

function formatRelativeDate(value) {
  try {
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;

    return formatDate(value);
  } catch {
    return "recently";
  }
}

/* =========================================================
   FILTERING
========================================================= */

function matchesFilters(novel) {
  const query = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  const tag = tagFilter.value;
  const tags = novel.tags || [];

  const searchMatch = !query ||
    novel.title.toLowerCase().includes(query) ||
    novel.sourceSite.toLowerCase().includes(query) ||
    tags.some((item) => item.toLowerCase().includes(query)) ||
    (novel.notes || "").toLowerCase().includes(query);

  const statusMatch = status === "all" || novel.status === status;
  const tagMatch = tag === "all" || tags.includes(tag);

  return searchMatch && statusMatch && tagMatch;
}


/* =========================================================
   TAG FILTER OPTIONS
========================================================= */

function populateTagFilter(items) {
  const tags = new Set();
  for (const novel of items) {
    for (const tag of novel.tags || []) tags.add(tag);
  }

  const sorted = [...tags].sort((a, b) => a.localeCompare(b));
  const previous = tagFilter.value;

  tagFilter.replaceChildren();
  const allOption = element("option", "", "All");
  allOption.value = "all";
  tagFilter.append(allOption);

  for (const tag of sorted) {
    const option = element("option", "", tag);
    option.value = tag;
    tagFilter.append(option);
  }

  tagFilter.value = sorted.includes(previous) ? previous : "all";
}

/* =========================================================
   READING STATS
========================================================= */

function renderStats(items) {
  const stats = computeReadingStats(items);
  statStreak.textContent = String(stats.streakDays);
  statWeek.textContent = String(stats.chaptersThisWeek);
  statMonth.textContent = String(stats.chaptersThisMonth);
  statCompleted.textContent = String(stats.completedCount);
  statTotal.textContent = String(stats.totalNovels);
}

/* =========================================================
   READING ACTIVITY HEATMAP
========================================================= */

const ACTIVITY_WEEKS = 52;
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function parseDayKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function renderActivity(items) {
  const heatmap = computeReadingHeatmap(items, { weeks: ACTIVITY_WEEKS });
  activity.hidden = heatmap.total === 0;
  if (activity.hidden) return;

  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  activitySummary.textContent =
    `${plural(heatmap.total, "chapter")} on ${plural(heatmap.activeDays, "day")} in the last year`;
  activityGrid.setAttribute("aria-label", `Reading activity: ${activitySummary.textContent}`);
  activityGrid.style.setProperty("--weeks", String(heatmap.weeks.length));

  const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
  const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short" });
  const cells = [element("span")];

  // Row-major: a header row of month labels, then one row per weekday.
  let previousMonth = -1; // so the first column is labelled too
  for (const week of heatmap.weeks) {
    const firstDay = parseDayKey(week[0].date);
    const startsMonth = firstDay.getMonth() !== previousMonth;
    previousMonth = firstDay.getMonth();
    cells.push(element("span", "activity-label", startsMonth ? monthFormat.format(firstDay) : ""));
  }

  WEEKDAY_LABELS.forEach((label, weekday) => {
    cells.push(element("span", "activity-label", label));
    for (const week of heatmap.weeks) {
      const day = week[weekday];
      const cell = element("span", "activity-cell");
      cell.dataset.level = String(day.level);
      if (day.future) {
        cell.classList.add("is-future");
      } else {
        const date = dayFormat.format(parseDayKey(day.date));
        cell.title = day.count ? `${plural(day.count, "chapter")} · ${date}` : `No chapters · ${date}`;
      }
      cells.push(cell);
    }
  });

  activityGrid.replaceChildren(...cells);
  activitySummary.dataset.total = activitySummary.textContent;

  // Newest weeks are on the right; show them first where the grid scrolls.
  const scroller = activityGrid.parentElement;
  scroller.scrollLeft = scroller.scrollWidth;
}

// Hovering a day shows its count in the summary line; leaving restores the total.
activityGrid.addEventListener("mouseover", (event) => {
  const cell = event.target.closest(".activity-cell[title]");
  if (cell) activitySummary.textContent = cell.title;
});
activityGrid.addEventListener("mouseleave", () => {
  activitySummary.textContent = activitySummary.dataset.total || "";
});

/* =========================================================
   HISTORY
========================================================= */

function getHistoryEntries(novel) {
  const history = Array.isArray(novel.chapterHistory) ? novel.chapterHistory : [];
  // materializeNovel already orders history ascending by read clock; newest
  // first is just the reverse. Sorting by chapter label here was the bug
  // ("Chapter 10" sorted before "Chapter 9").
  return [...history].reverse();
}

/* =========================================================
   DOM HELPERS
========================================================= */

function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function actionButton(text, action, iconName, className = "") {
  const node = element("button", className);
  node.type = "button";
  node.dataset.action = action;
  if (iconName) node.append(icon(iconName));
  node.append(document.createTextNode(text));
  return node;
}

function iconButton(label, action, iconName, className = "") {
  const node = element("button", `icon-button ${className}`.trim());
  node.type = "button";
  node.dataset.action = action;
  node.title = label;
  node.setAttribute("aria-label", label);
  node.append(icon(iconName));
  return node;
}

// The one set of status names: card pills, the edit form and the filter all
// use it (the popup's select says the same).
const STATUS_LABELS = { active: "Reading", paused: "Paused", completed: "Completed", dropped: "Dropped" };

function field(labelText, name, value) {
  const wrapper = element("div", "field");
  const label = element("label", "", labelText);
  const input = document.createElement("input");
  input.name = name;
  input.value = String(value || "");
  wrapper.append(label, input);
  return wrapper;
}

function tagsField(tags) {
  const wrapper = element("div", "field");
  const label = element("label", "", "Tags");
  const input = document.createElement("input");
  input.name = "tags";
  input.placeholder = "comma, separated, tags";
  input.value = (Array.isArray(tags) ? tags : []).join(", ");
  wrapper.append(label, input);
  return wrapper;
}

function notesField(value) {
  const wrapper = element("div", "field field-wide");
  const label = element("label", "", "Notes");
  const textarea = document.createElement("textarea");
  textarea.name = "notes";
  textarea.rows = 3;
  textarea.placeholder = "Personal notes about this novel…";
  textarea.value = String(value || "");
  wrapper.append(label, textarea);
  return wrapper;
}

function ratingField(value) {
  const wrapper = element("div", "field");
  const label = element("label", "", "Rating");
  const picker = element("div", "rating-input");

  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = "rating";
  hidden.value = String(value || 0);

  function paint() {
    const current = Number(hidden.value) || 0;
    for (const button of picker.querySelectorAll("button")) {
      button.classList.toggle("is-filled", Number(button.dataset.value) <= current);
    }
  }

  for (let starValue = 1; starValue <= 5; starValue += 1) {
    const button = element("button", "rating-star");
    button.type = "button";
    button.dataset.value = String(starValue);
    button.setAttribute("aria-label", `Rate ${starValue} star${starValue === 1 ? "" : "s"}`);
    button.append(icon("star"));
    button.addEventListener("click", () => {
      const current = Number(hidden.value) || 0;
      hidden.value = String(current === starValue ? 0 : starValue);
      paint();
    });
    picker.append(button);
  }

  paint();
  wrapper.append(label, picker, hidden);
  return wrapper;
}

/* =========================================================
   CARD
========================================================= */

function createCard(novel) {
  const article = element("article", "card");
  article.dataset.id = novel.id;

  const fallbackCover = novel.title
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();

  const historyEntries = getHistoryEntries(novel);

  // Cover
  const cover = element("div", "cover");
  if (novel.coverImageUrl) {
    const image = document.createElement("img");
    image.src = novel.coverImageUrl;
    image.alt = `${novel.title} cover`;
    // A cover that fails to load falls back to the initials, rather than
    // leaving alt text jammed against the edge of an unpadded cover.
    image.addEventListener("error", () => {
      image.remove();
      cover.textContent = fallbackCover;
    });
    cover.append(image);
  } else {
    cover.textContent = fallbackCover;
  }

  // Content: title, one line of meta, where you are, then actions.
  const content = element("div", "content");
  const titleRow = element("div", "title-row");
  const titleBlock = element("div", "title-block");
  titleBlock.append(element("h2", "", novel.title));

  const meta = element("div", "meta");
  const status = STATUS_LABELS[novel.status] ? novel.status : "active";
  const statusPill = element("span", "status-pill", STATUS_LABELS[status]);
  statusPill.dataset.status = status;
  const updated = element("span", "meta-updated", `Updated ${formatRelativeDate(novel.updatedAt)}`);
  updated.title = formatDate(novel.updatedAt);
  meta.append(statusPill, element("span", "meta-source", novel.sourceSite), updated);

  if (novel.rating > 0) {
    const ratingDisplay = element("span", "rating-display");
    ratingDisplay.setAttribute("role", "img");
    ratingDisplay.setAttribute("aria-label", `Rated ${novel.rating} out of 5`);
    ratingDisplay.append(icon("star"), document.createTextNode(String(novel.rating)));
    meta.append(ratingDisplay);
  }

  titleBlock.append(meta);
  titleRow.append(titleBlock);
  content.append(titleRow);

  // Where you are: the chapter to continue from, which is also the card's
  // primary action. The URL lives in the button's tooltip and the edit form.
  const progress = element("div", "progress-row");
  const chapterPill = element("span", "chapter-pill");
  chapterPill.title = novel.lastReadChapterLabel || "";
  chapterPill.append(icon("bookmark"), element("span", "chapter-pill-text", novel.lastReadChapterLabel || "Saved page"));
  const chaptersRead = historyEntries.length;
  progress.append(chapterPill);
  if (chaptersRead > 1) progress.append(element("span", "progress-count", `${chaptersRead} chapters read`));
  content.append(progress);

  // Tag chips
  if (novel.tags?.length) {
    const tagRow = element("div", "tag-chips");
    for (const tag of novel.tags) {
      const chip = element("span", "tag-chip");
      chip.append(icon("tag"), document.createTextNode(tag));
      tagRow.append(chip);
    }
    content.append(tagRow);
  }

  // Notes preview
  if (novel.notes) {
    const preview = novel.notes.length > 160 ? `${novel.notes.slice(0, 160)}…` : novel.notes;
    content.append(element("div", "notes-preview", preview));
  }

  // Actions: one clear primary, quiet icon buttons for the rest.
  const actions = element("div", "actions");
  const open = actionButton("Continue", "open", "external", "primary-card-action");
  open.title = novel.lastReadChapterUrl;
  actions.append(open, iconButton("Edit", "edit", "edit"), iconButton("Delete", "delete", "trash", "danger"));

  content.append(actions);

  // Chapter history
  if (historyEntries.length) {
    const details = element("details", "history");
    const summary = document.createElement("summary");
    summary.append(icon("history"), document.createTextNode(`History (${historyEntries.length})`));
    details.append(summary);

    const historyList = element("div", "history-list");
    for (const entry of historyEntries) {
      const item = element("div", "history-item");
      const link = element("a", "", entry.label || entry.url);
      link.href = entry.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = entry.url;
      item.append(link, element("span", "history-time", formatDate(entry.readAt)));
      historyList.append(item);
    }

    details.append(historyList);
    content.append(details);
  }

  // Edit form
  const form = element("form", "edit-grid");
  form.dataset.form = "edit";
  form.append(
    field("Novel title", "title", novel.title),
    field("Chapter", "lastReadChapterLabel", novel.lastReadChapterLabel),
    field("Current page", "lastReadChapterUrl", novel.lastReadChapterUrl),
    field("Novel home", "novelHomeUrl", novel.novelHomeUrl),
    field("Cover image", "coverImageUrl", novel.coverImageUrl),
    tagsField(novel.tags),
    ratingField(novel.rating),
    notesField(novel.notes)
  );

  const statusField = element("div", "field");
  const statusLabel = element("label", "", "Status");
  const statusSelect = document.createElement("select");
  statusSelect.name = "status";

  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    const option = element("option", "", label);
    option.value = value;
    option.selected = novel.status === value;
    statusSelect.append(option);
  }
  statusField.append(statusLabel, statusSelect);

  const formActions = element("div", "actions");
  const submit = element("button", "primary-card-action");
  submit.type = "submit";
  submit.append(icon("check"), document.createTextNode("Save changes"));
  formActions.append(submit, actionButton("Cancel", "cancel", null));

  // Status sits beside Rating, ahead of the full-width Notes.
  form.insertBefore(statusField, form.querySelector(".field-wide"));
  form.append(formActions);
  content.append(form);
  article.append(cover, content);
  return article;
}

/* =========================================================
   EMPTY STATE
========================================================= */

function createEmptyState() {
  const empty = element("section", "empty");
  const inner = element("div", "empty-inner");
  const image = element("div", "empty-icon");
  image.append(icon("book"));

  inner.append(
    image,
    element("h2", "", "No novels here yet"),
    element("p", "", "Open a chapter, use the extension popup, and save your first reading checkpoint.")
  );

  empty.append(inner);
  return empty;
}

/* =========================================================
   RECENTLY DELETED
========================================================= */

function renderTrash(items) {
  trash.hidden = !items.length;
  trashSummary.textContent = `Recently deleted (${items.length})`;
  trashList.replaceChildren();

  for (const novel of items) {
    const row = element("div", "trash-item");
    row.dataset.id = novel.id;

    const copy = element("div", "trash-copy");
    copy.append(
      element("strong", "", novel.title),
      element(
        "span",
        "",
        `${novel.sourceSite} · ${novel.lastReadChapterLabel || "Saved page"} · deleted ${formatRelativeDate(novel.deletedAt)}`
      )
    );

    const restore = actionButton("Restore", "restore", "history");
    restore.title = `Restorable until ${formatDate(novel.purgeAt)}`;
    const actions = element("div", "actions");
    actions.append(restore);

    row.append(copy, actions);
    trashList.append(row);
  }
}

trashList.addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-action="restore"]');
  const id = button?.closest(".trash-item")?.dataset.id;
  if (!id) return;

  button.disabled = true;
  try {
    await sendMessage("novel-tracker:library-restore", { id });
    await refresh();
  } catch (error) {
    button.disabled = false;
    window.alert(error.message || "Could not restore that novel.");
  }
});

/* =========================================================
   UNDO TOAST
========================================================= */

const UNDO_WINDOW_MS = 7000;
let toastTimer = null;

function hideToast() {
  window.clearTimeout(toastTimer);
  toast.hidden = true;
  toast.replaceChildren();
}

function startToastTimer() {
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, UNDO_WINDOW_MS);
}

// Hold the toast while the pointer or keyboard focus is on it, so there is
// always time to reach Undo (WCAG 2.2.1).
toast.addEventListener("mouseenter", () => window.clearTimeout(toastTimer));
toast.addEventListener("focusin", () => window.clearTimeout(toastTimer));
toast.addEventListener("mouseleave", () => {
  if (!toast.hidden && !toast.contains(document.activeElement)) startToastTimer();
});
toast.addEventListener("focusout", (event) => {
  if (!toast.hidden && !toast.contains(event.relatedTarget)) startToastTimer();
});

function showUndoToast(novel) {
  hideToast();

  const undo = element("button", "toast-action", "Undo");
  undo.type = "button";
  undo.addEventListener("click", async () => {
    hideToast();
    try {
      await sendMessage("novel-tracker:library-restore", { id: novel.id });
      await refresh();
    } catch (error) {
      window.alert(error.message || "Could not undo that delete. It is still in Recently deleted.");
    }
  });

  toast.append(element("span", "", `Deleted "${novel.title}"`), undo);
  toast.hidden = false;
  startToastTimer();
}

/* =========================================================
   RENDER
========================================================= */

function render() {
  const filtered = sortNovels(novels.filter(matchesFilters), sortSelect.value);
  library.replaceChildren();

  if (!filtered.length) {
    library.append(createEmptyState());
    animateEntrance = false;
    return;
  }

  filtered.forEach((novel, index) => {
    const card = createCard(novel);
    if (animateEntrance) {
      // Stagger only the first screenful, only once: re-renders while
      // searching or sorting should feel instant, not replay the intro.
      card.classList.add("is-entering");
      card.style.setProperty("--i", String(Math.min(index, 8)));
    }
    library.append(card);
  });
  animateEntrance = false;
}

async function refresh() {
  const view = await getLibraryView();
  const deleted = view.deleted;
  novels = view.novels;
  populateTagFilter(novels);
  renderStats(novels);
  renderActivity(novels);
  render();
  renderTrash(deleted);
}

/* =========================================================
   DOWNLOAD / IMPORT
========================================================= */

function downloadTextFile(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   LIBRARY EVENTS
========================================================= */

library.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const card = button.closest(".card");
  const id = card?.dataset.id;
  const novel = novels.find((item) => item.id === id);
  if (!id || !novel) return;

  const action = button.dataset.action;

  if (action === "open") {
    window.open(novel.lastReadChapterUrl, "_blank", "noopener,noreferrer");
    return;
  }

  if (action === "edit") {
    card.classList.add("editing");
    card.querySelector('input[name="title"]')?.focus();
    return;
  }

  if (action === "cancel") {
    card.classList.remove("editing");
    return;
  }

  if (action === "delete") {
    // No confirm(): the delete is undoable from the toast, and from Recently
    // deleted for the next 30 days.
    await sendMessage("novel-tracker:library-delete", { id });
    await refresh();
    showUndoToast(novel);
  }
});

library.addEventListener("submit", async (event) => {
  const form = event.target.closest('form[data-form="edit"]');
  if (!form) return;
  event.preventDefault();

  const card = form.closest(".card");
  const id = card?.dataset.id;
  if (!id) return;

  const data = new FormData(form);

  const patch = {
    title: String(data.get("title") || "").trim(),
    lastReadChapterLabel: String(data.get("lastReadChapterLabel") || "").trim(),
    lastReadChapterUrl: String(data.get("lastReadChapterUrl") || "").trim(),
    novelHomeUrl: String(data.get("novelHomeUrl") || "").trim(),
    coverImageUrl: String(data.get("coverImageUrl") || "").trim(),
    status: String(data.get("status") || "active").trim(),
    tags: normalizeTags(String(data.get("tags") || "")),
    notes: String(data.get("notes") || "").trim(),
    rating: Number(data.get("rating") || 0)
  };

  await sendMessage("novel-tracker:library-update", { id, patch });

  await refresh();
});

/* =========================================================
   FILTER EVENTS
========================================================= */

searchInput.addEventListener("input", render);
statusFilter.addEventListener("change", render);
tagFilter.addEventListener("change", render);
// Remember the chosen order for this browser; storage can be unavailable
// (private windows), in which case the page just starts at "Recent".
const SORT_KEY = "novel-tracker:sort";
try {
  const savedSort = globalThis.localStorage?.getItem(SORT_KEY);
  if (SORT_MODES.includes(savedSort)) sortSelect.value = savedSort;
} catch {
  // Keep the default order.
}

sortSelect.addEventListener("change", () => {
  try {
    globalThis.localStorage?.setItem(SORT_KEY, sortSelect.value);
  } catch {
    // Not remembered, still applied.
  }
  render();
});

/* =========================================================
   EXPORT
========================================================= */

exportJsonButton.addEventListener("click", async () => {
  const text = await exportNovelsJson();
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`novel-tracker-backup-${stamp}.json`, text);
});

exportCsvButton.addEventListener("click", async () => {
  // A byte-order mark so Excel opens the UTF-8 file with titles intact.
  const { novels: items } = await getLibraryView();
  items.sort((a, b) => a.title.localeCompare(b.title));
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`novel-tracker-library-${stamp}.csv`, `\uFEFF${novelsToCsv(items)}`, "text/csv;charset=utf-8");
});

/* =========================================================
   IMPORT
========================================================= */

importJsonButton.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    window.alert("That JSON file is too large to import.");
    importFileInput.value = "";
    return;
  }

  try {
    const text = await file.text();
    await sendMessage("novel-tracker:library-import", { text });
    await refresh();
  } catch (error) {
    console.error(error);
    window.alert("Could not import that JSON backup.");
  } finally {
    importFileInput.value = "";
  }
});

/* =========================================================
   SIGN IN
========================================================= */

async function startSignIn(provider) {
  await requireFirefoxSyncDataConsent();
  let snapshot = await sendMessage("novel-tracker:account-sign-in", { provider });

  if (snapshot.account?.needsAccountConfirmation) {
    const email = snapshot.account.pendingEmail || "the new account";
    // Switching providers lands here too, since Apple and Google are different
    // subjects — name the provider so the choice isn't just an unfamiliar email.
    const name = providerName(snapshot.account.pendingProvider);
    const target = name ? `${email} (${name})` : email;
    const confirmed = window.confirm(
      `This sign-in uses a different sync account. Merge this device's library into ${target}?`
    );
    snapshot = await sendMessage(confirmed ? "novel-tracker:account-confirm" : "novel-tracker:account-cancel");
  }

  renderAccount(snapshot);
  await refresh();
}

for (const provider of AUTH_PROVIDERS) {
  const button = document.createElement("button");
  button.type = "button";
  button.id = `sign-in-${provider.id}`;
  button.className = "top-action primary-action sign-in-button";
  button.dataset.provider = provider.id;
  // The visible label is hidden on narrow screens; keep the button named.
  button.setAttribute("aria-label", provider.label);

  const label = document.createElement("span");
  label.textContent = provider.label;
  button.append(icon(provider.icon || "user"), label);

  button.addEventListener("click", () => withBusy(button, () => startSignIn(provider.id)));
  signInActions.append(button);
}

/* =========================================================
   SYNC
========================================================= */

syncNowButton.addEventListener("click", () =>
  withBusy(syncNowButton, async () => {
    syncDetail.textContent = "Synchronizing…";
    syncIndicator.classList.add("syncing");

    const snapshot = await sendMessage("novel-tracker:sync-now");
    renderAccount(snapshot);
    await refresh();
  })
);

/* =========================================================
   SIGN OUT
========================================================= */

signOutButton.addEventListener("click", () =>
  withBusy(signOutButton, async () => {
    renderAccount(await sendMessage("novel-tracker:account-sign-out"));
  })
);

/* =========================================================
   DELETE ACCOUNT
========================================================= */

deleteAccountButton.addEventListener("click", () =>
  withBusy(deleteAccountButton, async () => {
    const confirmed = window.confirm(
      "Permanently delete your Novel Tracker account? This removes the account and everything synced to it. " +
      "Your library will remain on this device, and you can export it first from the library page."
    );
    if (!confirmed) return;

    renderAccount(await sendMessage("novel-tracker:account-delete"));
  })
);

/* =========================================================
   THEME
========================================================= */

// theme-init.js applies the saved choice before first paint; this only
// cycles it. Stored in localStorage (shared by the popup and this page, which
// are the same extension origin) so it is a per-browser preference and never syncs.
const THEME_KEY = "novel-tracker:theme";
const THEME_CHOICES = ["system", "light", "dark"];
const THEME_LABELS = { system: "match system", light: "light", dark: "dark" };
const themeToggle = document.querySelector("#theme-toggle");
let themeFadeTimer = null;

function readThemeChoice() {
  try {
    const saved = globalThis.localStorage?.getItem(THEME_KEY);
    return THEME_CHOICES.includes(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function applyThemeChoice(choice) {
  if (choice === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = choice;
  }

  themeToggle.dataset.themeChoice = choice;
  const label = `Theme: ${THEME_LABELS[choice]}`;
  themeToggle.setAttribute("aria-label", label);
  themeToggle.title = label;
}

themeToggle.addEventListener("click", () => {
  // Cycle from what is shown, not from storage: if storage is unavailable a
  // re-read would always say "system" and the toggle could never reach dark.
  const current = themeToggle.dataset.themeChoice || "system";
  const next = THEME_CHOICES[(THEME_CHOICES.indexOf(current) + 1) % THEME_CHOICES.length];
  try {
    globalThis.localStorage?.setItem(THEME_KEY, next);
  } catch {
    // Still switch for this page view even if it cannot be remembered.
  }
  // Fade every surface together for the switch only (see .theme-changing),
  // rather than leaving colour transitions on everything all the time.
  const root = document.documentElement;
  root.classList.add("theme-changing");
  window.clearTimeout(themeFadeTimer);
  themeFadeTimer = window.setTimeout(() => root.classList.remove("theme-changing"), 420);
  applyThemeChoice(next);
});

applyThemeChoice(readThemeChoice());

/* =========================================================
   INITIAL LOAD
========================================================= */

Promise.all([refresh(), refreshAccount()]);
