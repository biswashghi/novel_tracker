
import {
  deleteNovel,
  exportNovelsJson,
  getNovels,
  importNovelsJson,
  updateNovel
} from "./lib/storage.js";

import { getExtensionApi } from "./lib/extension-api.js";


const library = document.querySelector("#library");

const searchInput = document.querySelector("#search");
const statusFilter = document.querySelector("#status-filter");
const sortSelect = document.querySelector("#sort");

const exportJsonButton = document.querySelector("#export-json");
const importJsonButton = document.querySelector("#import-json");
const importFileInput = document.querySelector("#import-file");

const accountTitle = document.querySelector("#account-title");
const syncDetail = document.querySelector("#sync-detail");
const syncIndicator = document.querySelector("#sync-indicator");

const signInButton = document.querySelector("#sign-in");
const signOutButton = document.querySelector("#sign-out");
const syncNowButton = document.querySelector("#sync-now");
const deleteCloudButton = document.querySelector("#delete-cloud");


let novels = [];


/* =========================================================
   SVG HELPERS
========================================================= */

function icon(name, className = "") {
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );

  if (className) {
    svg.setAttribute("class", className);
  }

  svg.setAttribute("aria-hidden", "true");

  const use = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "use"
  );

  use.setAttribute("href", `#i-${name}`);

  svg.append(use);

  return svg;
}


/* =========================================================
   EXTENSION MESSAGING
========================================================= */

async function sendMessage(type) {
  const result =
    await getExtensionApi()
      .runtime
      .sendMessage({ type });

  if (result?.error) {
    throw new Error(result.error);
  }

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

function renderAccount(snapshot) {
  const account = snapshot?.account || {};
  const sync = snapshot?.sync || {};

  const signedIn = Boolean(account.signedIn);

  /*
   * Signed out:
   *   Sign in shown
   *
   * Signed in:
   *   Sync / Sign out / Delete shown
   */
  setVisible(signInButton, !signedIn);
  setVisible(syncNowButton, signedIn);
  setVisible(signOutButton, signedIn);
  setVisible(deleteCloudButton, signedIn);

  syncIndicator?.classList.remove(
    "syncing",
    "error",
    "signed-out"
  );

  if (signedIn) {
    accountTitle.textContent =
      account.name ||
      account.email ||
      "Novel Tracker account";
  } else {
    accountTitle.textContent = "Stored locally";

    syncIndicator?.classList.add(
      "signed-out"
    );
  }

  if (!signedIn) {
    syncDetail.textContent =
      "No account required";
  } else if (sync.state === "syncing") {
    syncDetail.textContent =
      "Synchronizing…";

    syncIndicator?.classList.add(
      "syncing"
    );
  } else if (sync.state === "error") {
    syncDetail.textContent =
      sync.lastError
        ? `Sync paused · ${sync.lastError}`
        : "Sync paused";

    syncIndicator?.classList.add(
      "error"
    );
  } else if (sync.lastSyncedAt) {
    syncDetail.textContent =
      `Synced ${formatRelativeDate(sync.lastSyncedAt)}`;
  } else {
    syncDetail.textContent =
      "Ready to sync";
  }
}

async function refreshAccount() {
  try {
    renderAccount(
      await sendMessage(
        "novel-tracker:account-status"
      )
    );
  } catch (error) {
    syncDetail.textContent =
      error.message;

    syncIndicator.classList.add(
      "error"
    );
  }
}


async function withBusy(button, operation) {
  button.disabled = true;
  button.classList.add("busy");

  try {
    return await operation();
  } catch (error) {
    window.alert(
      error.message ||
      "The account request failed."
    );

    return null;
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
  }
}


async function requestFirefoxSyncConsent() {
  const extensionApi =
    getExtensionApi();

  const declared =
    extensionApi
      .runtime
      .getManifest()
      ?.browser_specific_settings
      ?.gecko
      ?.data_collection_permissions
      ?.optional;

  if (
    !declared?.length ||
    !extensionApi.permissions?.request
  ) {
    return;
  }

  const granted =
    await extensionApi.permissions.request({
      data_collection: declared
    });

  if (!granted) {
    throw new Error(
      "Cloud sync remains off because data transmission permission was not granted."
    );
  }
}


/* =========================================================
   DATE FORMATTING
========================================================= */

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle: "medium",
        timeStyle: "short"
      }
    ).format(new Date(value));
  } catch {
    return "Unknown time";
  }
}


function formatRelativeDate(value) {
  try {
    const date = new Date(value);
    const diff =
      Date.now() - date.getTime();

    const minutes =
      Math.floor(diff / 60000);

    if (minutes < 1) {
      return "just now";
    }

    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours =
      Math.floor(minutes / 60);

    if (hours < 24) {
      return `${hours}h ago`;
    }

    const days =
      Math.floor(hours / 24);

    if (days < 7) {
      return `${days}d ago`;
    }

    return formatDate(value);
  } catch {
    return "recently";
  }
}


/* =========================================================
   FILTERING
========================================================= */

function matchesFilters(novel) {
  const query =
    searchInput
      .value
      .trim()
      .toLowerCase();

  const status =
    statusFilter.value;

  const searchMatch =
    !query ||
    novel.title
      .toLowerCase()
      .includes(query) ||
    novel.sourceSite
      .toLowerCase()
      .includes(query);

  const statusMatch =
    status === "all" ||
    novel.status === status;

  return (
    searchMatch &&
    statusMatch
  );
}


function sortNovels(items) {
  const next = [...items];
  const mode = sortSelect.value;

  if (mode === "title") {
    next.sort(
      (a, b) =>
        a.title.localeCompare(
          b.title
        )
    );
  } else if (mode === "source") {
    next.sort(
      (a, b) =>
        a.sourceSite.localeCompare(
          b.sourceSite
        )
    );
  } else {
    next.sort(
      (a, b) =>
        new Date(b.updatedAt) -
        new Date(a.updatedAt)
    );
  }

  return next;
}


/* =========================================================
   HISTORY
========================================================= */

function getHistoryEntries(novel) {
  const history =
    Array.isArray(
      novel.chapterHistory
    )
      ? novel.chapterHistory
      : [];

  return [...history].sort(
    (left, right) => {
      const leftKey =
        (
          left.label ||
          left.url ||
          ""
        ).toLowerCase();

      const rightKey =
        (
          right.label ||
          right.url ||
          ""
        ).toLowerCase();

      return rightKey.localeCompare(
        leftKey
      );
    }
  );
}


/* =========================================================
   DOM HELPERS
========================================================= */

function element(
  tag,
  className = "",
  text
) {
  const node =
    document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text !== undefined) {
    node.textContent =
      String(text);
  }

  return node;
}


function actionButton(
  text,
  action,
  iconName,
  className = ""
) {
  const node =
    element(
      "button",
      className
    );

  node.type = "button";
  node.dataset.action = action;

  if (iconName) {
    node.append(
      icon(iconName)
    );
  }

  node.append(
    document.createTextNode(text)
  );

  return node;
}


function field(
  labelText,
  name,
  value
) {
  const wrapper =
    element(
      "div",
      "field"
    );

  const label =
    element(
      "label",
      "",
      labelText
    );

  const input =
    document.createElement(
      "input"
    );

  input.name = name;
  input.value =
    String(value || "");

  wrapper.append(
    label,
    input
  );

  return wrapper;
}


/* =========================================================
   CARD
========================================================= */

function createCard(novel) {
  const article =
    element(
      "article",
      "card"
    );

  article.dataset.id =
    novel.id;

  const fallbackCover =
    novel.title
      .split(" ")
      .slice(0, 2)
      .map(
        (part) =>
          part[0] || ""
      )
      .join("")
      .toUpperCase();

  const historyEntries =
    getHistoryEntries(novel);


  /* -------------------------------------------------------
     Cover
  ------------------------------------------------------- */

  const cover =
    element(
      "div",
      "cover"
    );

  if (novel.coverImageUrl) {
    const image =
      document.createElement(
        "img"
      );

    image.src =
      novel.coverImageUrl;

    image.alt =
      `${novel.title} cover`;

    cover.append(image);
  } else {
    cover.textContent =
      fallbackCover;
  }


  /* -------------------------------------------------------
     Content
  ------------------------------------------------------- */

  const content =
    element(
      "div",
      "content"
    );

  const titleRow =
    element(
      "div",
      "title-row"
    );

  const titleBlock =
    document.createElement(
      "div"
    );

  titleBlock.append(
    element(
      "h2",
      "",
      novel.title
    )
  );

  const meta =
    element(
      "div",
      "meta"
    );

  meta.append(
    element(
      "span",
      "",
      novel.sourceSite
    ),

    element(
      "span",
      "",
      novel.status
    ),

    element(
      "span",
      "",
      `Updated ${formatDate(
        novel.updatedAt
      )}`
    )
  );

  titleBlock.append(meta);


  /* -------------------------------------------------------
     Chapter badge
  ------------------------------------------------------- */

  const chapterPill =
    element(
      "span",
      "chapter-pill"
    );

  chapterPill.append(
    icon("bookmark")
  );

  chapterPill.append(
    document.createTextNode(
      novel.lastReadChapterLabel ||
      "Saved page"
    )
  );


  titleRow.append(
    titleBlock,
    chapterPill
  );


  /* -------------------------------------------------------
     URL
  ------------------------------------------------------- */

  const chapterLink =
    element(
      "div",
      "chapter-link",
      novel.lastReadChapterUrl
    );

  chapterLink.title =
    novel.lastReadChapterUrl;


  /* -------------------------------------------------------
     Actions
  ------------------------------------------------------- */

  const actions =
    element(
      "div",
      "actions"
    );

  actions.append(
    actionButton(
      "Open chapter",
      "open",
      "external",
      "primary-card-action"
    ),

    actionButton(
      "Edit",
      "edit",
      "edit"
    ),

    actionButton(
      "Delete",
      "delete",
      "trash",
      "danger"
    )
  );


  content.append(
    titleRow,
    chapterLink,
    actions
  );


  /* -------------------------------------------------------
     History
  ------------------------------------------------------- */

  if (historyEntries.length) {
    const details =
      element(
        "details",
        "history"
      );

    const summary =
      document.createElement(
        "summary"
      );

    summary.append(
      icon("history")
    );

    summary.append(
      document.createTextNode(
        `History (${historyEntries.length})`
      )
    );

    details.append(summary);

    const historyList =
      element(
        "div",
        "history-list"
      );

    for (
      const entry
      of historyEntries
    ) {
      const item =
        element(
          "div",
          "history-item"
        );

      const link =
        element(
          "a",
          "",
          entry.label ||
          entry.url
        );

      link.href =
        entry.url;

      link.target =
        "_blank";

      link.rel =
        "noopener noreferrer";

      link.title =
        entry.url;

      item.append(
        link,

        element(
          "span",
          "history-time",
          formatDate(
            entry.readAt
          )
        )
      );

      historyList.append(
        item
      );
    }

    details.append(
      historyList
    );

    content.append(
      details
    );
  }


  /* -------------------------------------------------------
     Edit form
  ------------------------------------------------------- */

  const form =
    element(
      "form",
      "edit-grid"
    );

  form.dataset.form =
    "edit";

  form.append(
    field(
      "Novel title",
      "title",
      novel.title
    ),

    field(
      "Chapter",
      "lastReadChapterLabel",
      novel.lastReadChapterLabel
    ),

    field(
      "Current page",
      "lastReadChapterUrl",
      novel.lastReadChapterUrl
    ),

    field(
      "Novel home",
      "novelHomeUrl",
      novel.novelHomeUrl
    ),

    field(
      "Cover image",
      "coverImageUrl",
      novel.coverImageUrl
    )
  );


  const statusField =
    element(
      "div",
      "field"
    );

  const statusLabel =
    element(
      "label",
      "",
      "Status"
    );

  const statusSelect =
    document.createElement(
      "select"
    );

  statusSelect.name =
    "status";


  for (
    const [value, label]
    of [
      ["active", "Active"],
      ["paused", "Paused"],
      ["completed", "Completed"],
      ["dropped", "Dropped"]
    ]
  ) {
    const option =
      element(
        "option",
        "",
        label
      );

    option.value =
      value;

    option.selected =
      novel.status === value;

    statusSelect.append(
      option
    );
  }


  statusField.append(
    statusLabel,
    statusSelect
  );


  const formActions =
    element(
      "div",
      "actions"
    );


  const submit =
    element(
      "button",
      "primary-card-action"
    );

  submit.type =
    "submit";

  submit.append(
    icon("check")
  );

  submit.append(
    document.createTextNode(
      "Save changes"
    )
  );


  formActions.append(
    submit,

    actionButton(
      "Cancel",
      "cancel",
      null
    )
  );


  form.append(
    statusField,
    formActions
  );


  content.append(form);

  article.append(
    cover,
    content
  );

  return article;
}


/* =========================================================
   EMPTY STATE
========================================================= */

function createEmptyState() {
  const empty =
    element(
      "section",
      "empty"
    );

  const inner =
    element(
      "div",
      "empty-inner"
    );

  const image =
    element(
      "div",
      "empty-icon"
    );

  image.append(
    icon("book")
  );

  inner.append(
    image,

    element(
      "h2",
      "",
      "No novels here yet"
    ),

    element(
      "p",
      "",
      "Open a chapter, use the extension popup, and save your first reading checkpoint."
    )
  );

  empty.append(inner);

  return empty;
}


/* =========================================================
   RENDER
========================================================= */

function render() {
  const filtered =
    sortNovels(
      novels.filter(
        matchesFilters
      )
    );

  library.replaceChildren();

  if (!filtered.length) {
    library.append(
      createEmptyState()
    );

    return;
  }

  filtered.forEach(
    (novel) =>
      library.append(
        createCard(novel)
      )
  );
}


async function refresh() {
  novels =
    await getNovels();

  render();
}


/* =========================================================
   DOWNLOAD / IMPORT
========================================================= */

function downloadTextFile(
  filename,
  text
) {
  const blob =
    new Blob(
      [text],
      {
        type:
          "application/json"
      }
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement(
      "a"
    );

  link.href =
    url;

  link.download =
    filename;

  link.click();

  URL.revokeObjectURL(
    url
  );
}


/* =========================================================
   LIBRARY EVENTS
========================================================= */

library.addEventListener(
  "click",
  async (event) => {

    const button =
      event.target.closest(
        "button[data-action]"
      );

    if (!button) {
      return;
    }

    const card =
      button.closest(
        ".card"
      );

    const id =
      card?.dataset.id;

    const novel =
      novels.find(
        (item) =>
          item.id === id
      );

    if (!id || !novel) {
      return;
    }

    const action =
      button.dataset.action;


    if (action === "open") {
      window.open(
        novel.lastReadChapterUrl,
        "_blank",
        "noopener,noreferrer"
      );

      return;
    }


    if (action === "edit") {
      card.classList.add(
        "editing"
      );

      card
        .querySelector(
          'input[name="title"]'
        )
        ?.focus();

      return;
    }


    if (action === "cancel") {
      card.classList.remove(
        "editing"
      );

      return;
    }


    if (action === "delete") {
      const confirmed =
        window.confirm(
          `Delete "${novel.title}" from your tracker?`
        );

      if (!confirmed) {
        return;
      }

      await deleteNovel(id);

      await refresh();
    }

  }
);


library.addEventListener(
  "submit",
  async (event) => {

    const form =
      event.target.closest(
        'form[data-form="edit"]'
      );

    if (!form) {
      return;
    }

    event.preventDefault();

    const card =
      form.closest(
        ".card"
      );

    const id =
      card?.dataset.id;

    if (!id) {
      return;
    }

    const data =
      new FormData(form);


    await updateNovel(
      id,
      {
        title:
          String(
            data.get("title") ||
            ""
          ).trim(),

        lastReadChapterLabel:
          String(
            data.get(
              "lastReadChapterLabel"
            ) || ""
          ).trim(),

        lastReadChapterUrl:
          String(
            data.get(
              "lastReadChapterUrl"
            ) || ""
          ).trim(),

        novelHomeUrl:
          String(
            data.get(
              "novelHomeUrl"
            ) || ""
          ).trim(),

        coverImageUrl:
          String(
            data.get(
              "coverImageUrl"
            ) || ""
          ).trim(),

        status:
          String(
            data.get("status") ||
            "active"
          ).trim()
      }
    );


    await refresh();

  }
);


/* =========================================================
   FILTER EVENTS
========================================================= */

searchInput.addEventListener(
  "input",
  render
);

statusFilter.addEventListener(
  "change",
  render
);

sortSelect.addEventListener(
  "change",
  render
);


/* =========================================================
   EXPORT
========================================================= */

exportJsonButton.addEventListener(
  "click",
  async () => {

    const text =
      await exportNovelsJson();

    const stamp =
      new Date()
        .toISOString()
        .slice(0, 10);

    downloadTextFile(
      `novel-tracker-backup-${stamp}.json`,
      text
    );

  }
);


/* =========================================================
   IMPORT
========================================================= */

importJsonButton.addEventListener(
  "click",
  () => {
    importFileInput.click();
  }
);


importFileInput.addEventListener(
  "change",
  async (event) => {

    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      window.alert(
        "That JSON file is too large to import."
      );

      importFileInput.value =
        "";

      return;
    }

    try {
      const text =
        await file.text();

      await importNovelsJson(
        text
      );

      await refresh();
    } catch (error) {
      console.error(error);

      window.alert(
        "Could not import that JSON backup."
      );
    } finally {
      importFileInput.value =
        "";
    }

  }
);


/* =========================================================
   SIGN IN
========================================================= */

signInButton.addEventListener(
  "click",
  () =>
    withBusy(
      signInButton,
      async () => {
        await requestFirefoxSyncConsent();

        let snapshot =
          await sendMessage(
            "novel-tracker:account-sign-in"
          );

        if (
          snapshot.account
            ?.needsAccountConfirmation
        ) {
          const email =
            snapshot.account.pendingEmail ||
            "the new account";

          const confirmed =
            window.confirm(
              `Merge the library retained on this device into ${email}?`
            );

          snapshot =
            await sendMessage(
              confirmed
                ? "novel-tracker:account-confirm"
                : "novel-tracker:account-cancel"
            );
        }

        console.log(
          "Account snapshot after login:",
          snapshot
        );

        renderAccount(snapshot);

        await refresh();
      }
    )
);

/* =========================================================
   SYNC
========================================================= */

syncNowButton.addEventListener(
  "click",
  () =>
    withBusy(
      syncNowButton,
      async () => {

        syncDetail.textContent =
          "Synchronizing…";

        syncIndicator.classList.add(
          "syncing"
        );


        const snapshot =
          await sendMessage(
            "novel-tracker:sync-now"
          );


        renderAccount(snapshot);

        await refresh();

      }
    )
);


/* =========================================================
   SIGN OUT
========================================================= */

signOutButton.addEventListener(
  "click",
  () =>
    withBusy(
      signOutButton,
      async () => {

        renderAccount(
          await sendMessage(
            "novel-tracker:account-sign-out"
          )
        );

      }
    )
);


/* =========================================================
   DELETE CLOUD DATA
========================================================= */

deleteCloudButton.addEventListener(
  "click",
  () =>
    withBusy(
      deleteCloudButton,
      async () => {

        const confirmed =
          window.confirm(
            "Permanently delete this account's synchronized Novel Tracker data? Your library will remain on this device."
          );

        if (!confirmed) {
          return;
        }


        renderAccount(
          await sendMessage(
            "novel-tracker:account-delete-cloud"
          )
        );

      }
    )
);


/* =========================================================
   INITIAL LOAD
========================================================= */

Promise.all([
  refresh(),
  refreshAccount()
]);
