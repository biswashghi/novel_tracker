import { getExtensionApi } from "./extension-api.js";
import { sendNativeMessage } from "./safari-native-messaging.js";

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
    return nativeResponse(await sendNativeMessage(api.runtime, {
      type: "novel-tracker.http.request",
      url: String(url),
      method: String(options.method || "GET").toUpperCase(),
      headers,
      body: typeof options.body === "string" ? options.body : ""
    }));
  }
  return fetch(url, options);
}
