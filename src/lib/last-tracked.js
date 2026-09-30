import { getExtensionApi } from "./extension-api.js";
import { sendNativeMessage } from "./safari-native-messaging.js";

// Field limits the native handler also enforces; trimming here keeps a long
// scraped title from getting the whole report rejected there.
const MAX_TEXT = 300;
const MAX_URL = 2048;

/**
 * What the containing app shows as "Last tracked": the novel and chapter
 * that were just saved or followed, and whether the reader did it or the
 * content script did. Only titles, chapter labels and the chapter URL,
 * which the app shows back to the same reader on the same device.
 */
export function lastTrackedStatus(novel, source, now = new Date()) {
  const chapterUrl = String(novel?.lastReadChapterUrl || "");
  if (!/^https?:\/\//.test(chapterUrl) || chapterUrl.length > MAX_URL) return null;
  return {
    title: String(novel.title || "").trim().slice(0, MAX_TEXT),
    chapterLabel: String(novel.lastReadChapterLabel || "").trim().slice(0, MAX_TEXT),
    chapterUrl,
    source: source === "auto" ? "auto" : "manual",
    at: now.toISOString()
  };
}

/**
 * Hands the status to the Safari app, which has no other way to see the
 * extension's storage. Chrome and Firefox have no containing app, so this
 * is Safari-only, and it never blocks or fails a save.
 */
export function reportLastTracked(novel, source, api = getExtensionApi()) {
  if (api?.identity || !api?.runtime?.sendNativeMessage) return Promise.resolve(false);
  const status = lastTrackedStatus(novel, source);
  if (!status) return Promise.resolve(false);
  return sendNativeMessage(api.runtime, { type: "novel-tracker.status.store", status })
    .then((response) => !response?.error)
    .catch(() => false);
}
