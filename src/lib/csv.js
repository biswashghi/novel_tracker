const CSV_COLUMNS = [
  ["title", "Title"],
  ["sourceSite", "Source"],
  ["novelHomeUrl", "Novel page"],
  ["lastReadChapterLabel", "Chapter"],
  ["lastReadChapterUrl", "Chapter URL"],
  ["status", "Status"],
  ["rating", "Rating"],
  ["tags", "Tags"],
  ["notes", "Notes"],
  ["chaptersRead", "Chapters read"],
  ["updatedAt", "Last read"]
];

// Spreadsheet apps evaluate a cell that starts with one of these as a
// formula, so a novel titled "=HYPERLINK(…)" would run on open. Prefixing an
// apostrophe makes it plain text (OWASP's CSV injection guidance).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value) {
  let text = value == null ? "" : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  // RFC 4180: quote fields containing a delimiter, quote or line break, and
  // double any quotes inside.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serializes rows (arrays of cell values) as RFC 4180 CSV with CRLF line ends. */
export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

/** One row per novel, in the column order spreadsheets and other trackers expect. */
export function novelsToCsv(novels) {
  const rows = [CSV_COLUMNS.map(([, header]) => header)];
  for (const novel of novels) {
    const values = {
      ...novel,
      rating: novel.rating || "",
      tags: (novel.tags || []).join("; "),
      chaptersRead: Array.isArray(novel.chapterHistory) ? novel.chapterHistory.length : ""
    };
    rows.push(CSV_COLUMNS.map(([key]) => values[key]));
  }
  return toCsv(rows);
}
