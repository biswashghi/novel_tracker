import { deleteNovel, exportNovelsJson, getNovels, importNovelsJson, updateNovel } from "./lib/storage.js";

const library = document.querySelector("#library");
const searchInput = document.querySelector("#search");
const statusFilter = document.querySelector("#status-filter");
const sortSelect = document.querySelector("#sort");
const headerStats = document.querySelector("#header-stats");
const exportJsonButton = document.querySelector("#export-json");
const importJsonButton = document.querySelector("#import-json");
const importFileInput = document.querySelector("#import-file");

let novels = [];

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return map[char];
  });
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
  headerStats.innerHTML = `
    <span class="pill">${novels.length} tracked</span>
    <span class="pill">${activeCount} active</span>
  `;
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
  const historyMarkup = historyEntries.length
    ? `
      <details class="history">
        <summary>History (${historyEntries.length})</summary>
        <div class="history-list">
          ${historyEntries
            .map((entry) => {
              const label = escapeHtml(entry.label || entry.url);
              const url = escapeHtml(entry.url);
              return `
                <div class="history-item">
                  <a href="${url}" target="_blank" rel="noopener noreferrer" title="${url}">${label}</a>
                  <span class="history-time">${formatDate(entry.readAt)}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </details>
    `
    : "";

  article.innerHTML = `
    <div class="cover">
      ${
        novel.coverImageUrl
          ? `<img src="${escapeHtml(novel.coverImageUrl)}" alt="${escapeHtml(novel.title)} cover">`
          : escapeHtml(fallbackCover)
      }
    </div>
    <div class="content">
      <div class="title-row">
        <div>
          <h2>${escapeHtml(novel.title)}</h2>
          <div class="meta">
            <span>${escapeHtml(novel.sourceSite)}</span>
            <span>${escapeHtml(novel.status)}</span>
            <span>Updated ${formatDate(novel.updatedAt)}</span>
          </div>
        </div>
        <span class="pill">${escapeHtml(novel.lastReadChapterLabel || "Saved page")}</span>
      </div>

      <div class="chapter-link" title="${escapeHtml(novel.lastReadChapterUrl)}">${escapeHtml(novel.lastReadChapterUrl)}</div>

      <div class="actions">
        <button type="button" data-action="open">Open chapter</button>
        <button type="button" class="secondary" data-action="edit">Edit</button>
        <button type="button" class="danger" data-action="delete">Delete</button>
      </div>

      ${historyMarkup}

      <form class="edit-grid" data-form="edit">
        <div class="field">
          <label>Title</label>
          <input name="title" value="${escapeHtml(novel.title)}">
        </div>
        <div class="field">
          <label>Chapter label</label>
          <input name="lastReadChapterLabel" value="${escapeHtml(novel.lastReadChapterLabel || "")}">
        </div>
        <div class="field">
          <label>Chapter URL</label>
          <input name="lastReadChapterUrl" value="${escapeHtml(novel.lastReadChapterUrl || "")}">
        </div>
        <div class="field">
          <label>Novel home URL</label>
          <input name="novelHomeUrl" value="${escapeHtml(novel.novelHomeUrl || "")}">
        </div>
        <div class="field">
          <label>Cover image URL</label>
          <input name="coverImageUrl" value="${escapeHtml(novel.coverImageUrl || "")}">
        </div>
        <div class="field">
          <label>Status</label>
          <select name="status">
            <option value="active" ${novel.status === "active" ? "selected" : ""}>Active</option>
            <option value="paused" ${novel.status === "paused" ? "selected" : ""}>Paused</option>
            <option value="completed" ${novel.status === "completed" ? "selected" : ""}>Completed</option>
            <option value="dropped" ${novel.status === "dropped" ? "selected" : ""}>Dropped</option>
          </select>
        </div>
        <div class="actions">
          <button type="submit">Save changes</button>
          <button type="button" class="ghost" data-action="cancel">Cancel</button>
        </div>
      </form>
    </div>
  `;

  return article;
}

function render() {
  const filtered = sortNovels(novels.filter(matchesFilters));
  library.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement("section");
    empty.className = "panel empty";
    empty.innerHTML = `
      <h2>No novels yet</h2>
      <p>Open a chapter page, use the extension popup, and save your first reading checkpoint.</p>
    `;
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

refresh();
