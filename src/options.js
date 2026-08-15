import { deleteNovel, exportNovelsJson, getNovels, importNovelsJson, updateNovel } from "./lib/storage.js";
import { getExtensionApi } from "./lib/extension-api.js";

const library = document.querySelector("#library");
const searchInput = document.querySelector("#search");
const statusFilter = document.querySelector("#status-filter");
const sortSelect = document.querySelector("#sort");
const headerStats = document.querySelector("#header-stats");
const exportJsonButton = document.querySelector("#export-json");
const importJsonButton = document.querySelector("#import-json");
const importFileInput = document.querySelector("#import-file");
const accountTitle = document.querySelector("#account-title");
const accountDetail = document.querySelector("#account-detail");
const syncDetail = document.querySelector("#sync-detail");
const signInButton = document.querySelector("#sign-in");
const signOutButton = document.querySelector("#sign-out");
const syncNowButton = document.querySelector("#sync-now");
const deleteCloudButton = document.querySelector("#delete-cloud");

let novels = [];

async function sendMessage(type) {
  const result = await getExtensionApi().runtime.sendMessage({ type });
  if (result?.error) throw new Error(result.error);
  return result;
}

function renderAccount(snapshot) {
  const account = snapshot?.account || {};
  const sync = snapshot?.sync || {};
  signInButton.hidden = account.signedIn;
  signOutButton.hidden = !account.signedIn;
  syncNowButton.hidden = !account.signedIn;
  deleteCloudButton.hidden = !account.signedIn;
  if (account.signedIn) {
    accountTitle.textContent = `Syncing as ${account.name || account.email}`;
    accountDetail.textContent = "Your library stays on this device and synchronizes through your Novel Tracker account.";
  } else {
    accountTitle.textContent = "Stored locally on this device";
    accountDetail.textContent = "Sign in with Google only if you want cloud synchronization across browsers.";
  }
  if (sync.state === "syncing") {
    syncDetail.textContent = "Synchronizing…";
  } else if (sync.state === "error") {
    syncDetail.textContent = `Sync paused: ${sync.lastError || "unknown error"}`;
  } else if (sync.lastSyncedAt) {
    syncDetail.textContent = `Last synced ${formatDate(sync.lastSyncedAt)}`;
  } else {
    syncDetail.textContent = account.signedIn ? "Ready to synchronize." : "No account is required.";
  }
}

async function refreshAccount() {
  try {
    renderAccount(await sendMessage("novel-tracker:account-status"));
  } catch (error) {
    syncDetail.textContent = error.message;
  }
}

async function withBusy(button, operation) {
  button.disabled = true;
  try {
    return await operation();
  } catch (error) {
    window.alert(error.message || "The account request failed.");
    return null;
  } finally {
    button.disabled = false;
  }
}

async function requestFirefoxSyncConsent() {
  const extensionApi = getExtensionApi();
  const declared = extensionApi.runtime.getManifest()?.browser_specific_settings?.gecko?.data_collection_permissions?.optional;
  if (!declared?.length || !extensionApi.permissions?.request) return;
  const granted = await extensionApi.permissions.request({ data_collection: declared });
  if (!granted) throw new Error("Cloud sync remains off because data transmission permission was not granted.");
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return "Unknown time";
  }
}

function matchesFilters(novel) {
  const query = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;

  const searchMatch =
    !query ||
    novel.title.toLowerCase().includes(query) ||
    novel.sourceSite.toLowerCase().includes(query);

  const statusMatch = status === "all" || novel.status === status;
  return searchMatch && statusMatch;
}

function sortNovels(items) {
  const next = [...items];
  const mode = sortSelect.value;

  if (mode === "title") {
    next.sort((a, b) => a.title.localeCompare(b.title));
  } else if (mode === "source") {
    next.sort((a, b) => a.sourceSite.localeCompare(b.sourceSite));
  } else {
    next.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  return next;
}

function renderHeaderStats() {
  const activeCount = novels.filter((novel) => novel.status === "active").length;
  const tracked = document.createElement("span");
  tracked.className = "pill";
  tracked.textContent = `${novels.length} tracked`;
  const active = document.createElement("span");
  active.className = "pill";
  active.textContent = `${activeCount} active`;
  headerStats.replaceChildren(tracked, active);
}

function getHistoryEntries(novel) {
  const history = Array.isArray(novel.chapterHistory) ? novel.chapterHistory : [];
  return [...history].sort((left, right) => {
    const leftKey = (left.label || left.url || "").toLowerCase();
    const rightKey = (right.label || right.url || "").toLowerCase();
    return rightKey.localeCompare(leftKey);
  });
}

function createCard(novel) {
  const article = document.createElement("article");
  article.className = "panel card";
  article.dataset.id = novel.id;

  const fallbackCover = novel.title
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
  const historyEntries = getHistoryEntries(novel);

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (text, action, className = "") => {
    const node = element("button", className, text);
    node.type = "button";
    node.dataset.action = action;
    return node;
  };
  const field = (labelText, name, value) => {
    const wrapper = element("div", "field");
    const label = element("label", "", labelText);
    const input = document.createElement("input");
    input.name = name;
    input.value = String(value || "");
    wrapper.append(label, input);
    return wrapper;
  };

  const cover = element("div", "cover");
  if (novel.coverImageUrl) {
    const image = document.createElement("img");
    image.src = novel.coverImageUrl;
    image.alt = `${novel.title} cover`;
    cover.append(image);
  } else {
    cover.textContent = fallbackCover;
  }

  const content = element("div", "content");
  const titleRow = element("div", "title-row");
  const titleBlock = document.createElement("div");
  titleBlock.append(element("h2", "", novel.title));
  const meta = element("div", "meta");
  meta.append(
    element("span", "", novel.sourceSite),
    element("span", "", novel.status),
    element("span", "", `Updated ${formatDate(novel.updatedAt)}`)
  );
  titleBlock.append(meta);
  titleRow.append(titleBlock, element("span", "pill", novel.lastReadChapterLabel || "Saved page"));

  const chapterLink = element("div", "chapter-link", novel.lastReadChapterUrl);
  chapterLink.title = novel.lastReadChapterUrl;
  const actions = element("div", "actions");
  actions.append(button("Open chapter", "open"), button("Edit", "edit", "secondary"), button("Delete", "delete", "danger"));
  content.append(titleRow, chapterLink, actions);

  if (historyEntries.length) {
    const details = element("details", "history");
    details.append(element("summary", "", `History (${historyEntries.length})`));
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

  const form = element("form", "edit-grid");
  form.dataset.form = "edit";
  form.append(
    field("Title", "title", novel.title),
    field("Chapter label", "lastReadChapterLabel", novel.lastReadChapterLabel),
    field("Chapter URL", "lastReadChapterUrl", novel.lastReadChapterUrl),
    field("Novel home URL", "novelHomeUrl", novel.novelHomeUrl),
    field("Cover image URL", "coverImageUrl", novel.coverImageUrl)
  );
  const statusField = element("div", "field");
  const statusSelect = document.createElement("select");
  statusSelect.name = "status";
  for (const [value, label] of [["active", "Active"], ["paused", "Paused"], ["completed", "Completed"], ["dropped", "Dropped"]]) {
    const option = element("option", "", label);
    option.value = value;
    option.selected = novel.status === value;
    statusSelect.append(option);
  }
  statusField.append(element("label", "", "Status"), statusSelect);
  const formActions = element("div", "actions");
  const submit = element("button", "", "Save changes");
  submit.type = "submit";
  formActions.append(submit, button("Cancel", "cancel", "ghost"));
  form.append(statusField, formActions);
  content.append(form);
  article.append(cover, content);

  return article;
}

function render() {
  const filtered = sortNovels(novels.filter(matchesFilters));
  library.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement("section");
    empty.className = "panel empty";
    const heading = document.createElement("h2");
    heading.textContent = "No novels yet";
    const description = document.createElement("p");
    description.textContent = "Open a chapter page, use the extension popup, and save your first reading checkpoint.";
    empty.append(heading, description);
    library.append(empty);
    return;
  }

  filtered.forEach((novel) => library.append(createCard(novel)));
}

async function refresh() {
  novels = await getNovels();
  renderHeaderStats();
  render();
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

library.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const card = button.closest(".card");
  const id = card?.dataset.id;
  const novel = novels.find((item) => item.id === id);
  if (!id || !novel) {
    return;
  }

  const action = button.dataset.action;

  if (action === "open") {
    window.open(novel.lastReadChapterUrl, "_blank", "noopener,noreferrer");
    return;
  }

  if (action === "edit") {
    card.classList.add("editing");
    return;
  }

  if (action === "cancel") {
    card.classList.remove("editing");
    return;
  }

  if (action === "delete") {
    const confirmed = window.confirm(`Delete "${novel.title}" from your tracker?`);
    if (!confirmed) {
      return;
    }

    await deleteNovel(id);
    await refresh();
  }
});

library.addEventListener("submit", async (event) => {
  const form = event.target.closest('form[data-form="edit"]');
  if (!form) {
    return;
  }

  event.preventDefault();
  const card = form.closest(".card");
  const id = card?.dataset.id;
  if (!id) {
    return;
  }

  const data = new FormData(form);
  await updateNovel(id, {
    title: String(data.get("title") || "").trim(),
    lastReadChapterLabel: String(data.get("lastReadChapterLabel") || "").trim(),
    lastReadChapterUrl: String(data.get("lastReadChapterUrl") || "").trim(),
    novelHomeUrl: String(data.get("novelHomeUrl") || "").trim(),
    coverImageUrl: String(data.get("coverImageUrl") || "").trim(),
    status: String(data.get("status") || "active").trim()
  });

  await refresh();
});

searchInput.addEventListener("input", render);
statusFilter.addEventListener("change", render);
sortSelect.addEventListener("change", render);

exportJsonButton.addEventListener("click", async () => {
  const text = await exportNovelsJson();
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`novel-tracker-backup-${stamp}.json`, text);
});

importJsonButton.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    window.alert("That JSON file is too large to import.");
    importFileInput.value = "";
    return;
  }

  try {
    const text = await file.text();
    await importNovelsJson(text);
    await refresh();
  } catch (error) {
    console.error(error);
    window.alert("Could not import that JSON backup.");
  } finally {
    importFileInput.value = "";
  }
});

signInButton.addEventListener("click", () => withBusy(signInButton, async () => {
  await requestFirefoxSyncConsent();
  let snapshot = await sendMessage("novel-tracker:account-sign-in");
  if (snapshot.account?.needsAccountConfirmation) {
    const email = snapshot.account.pendingEmail || "the new account";
    const confirmed = window.confirm(`Merge the library retained on this device into ${email}?`);
    snapshot = await sendMessage(confirmed ? "novel-tracker:account-confirm" : "novel-tracker:account-cancel");
  }
  renderAccount(snapshot);
  await refresh();
}));

syncNowButton.addEventListener("click", () => withBusy(syncNowButton, async () => {
  syncDetail.textContent = "Synchronizing…";
  const snapshot = await sendMessage("novel-tracker:sync-now");
  renderAccount(snapshot);
  await refresh();
}));

signOutButton.addEventListener("click", () => withBusy(signOutButton, async () => {
  renderAccount(await sendMessage("novel-tracker:account-sign-out"));
}));

deleteCloudButton.addEventListener("click", () => withBusy(deleteCloudButton, async () => {
  const confirmed = window.confirm("Permanently delete this account's synchronized Novel Tracker data? Your library will remain on this device.");
  if (!confirmed) return;
  renderAccount(await sendMessage("novel-tracker:account-delete-cloud"));
}));

Promise.all([refresh(), refreshAccount()]);
