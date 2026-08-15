import { getExtensionApi } from "./extension-api.js";

const SAFARI_NATIVE_APP_ID = "app.noveltracker.extension";

function sendNative(runtime, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    const callback = (value) => {
      const runtimeError = runtime.lastError;
      finish(value, runtimeError ? new Error(runtimeError.message || String(runtimeError)) : null);
    };
    try {
      const result = runtime.sendNativeMessage(message);
      if (result?.then) result.then((value) => finish(value), (error) => finish(undefined, error));
    } catch (error) {
      finish(undefined, error);
    }
  });
}

function nativeResponse(result) {
  if (result?.error) throw new Error(result.error);
  if (!Number.isInteger(result?.status) || typeof result?.body !== "string") {
    throw new Error("Safari did not return an HTTP response");
  }
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    text: async () => result.body,
    json: async () => JSON.parse(result.body)
  };
}

export async function platformFetch(url, options = {}) {
  const api = getExtensionApi();
  if (!api?.identity && api?.runtime?.sendNativeMessage) {
    const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
    return nativeResponse(await sendNative(api.runtime, {
      type: "novel-tracker.http.request",
      url: String(url),
      method: String(options.method || "GET").toUpperCase(),
      headers,
      body: typeof options.body === "string" ? options.body : ""
    }));
  }
  return fetch(url, options);
}
