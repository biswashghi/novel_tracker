// Shared native-messaging transport used by both the Safari OAuth adapter
// (auth-platform.js) and the Safari HTTP adapter (platform-http.js). Safari
// Web Extensions talk to their containing app through `sendNativeMessage`
// instead of network APIs, so this is the one place that wraps its
// callback-or-promise contract into a normal Promise.
export const SAFARI_NATIVE_APP_ID = "app.noveltracker.extension";

export function sendNativeMessage(runtime, message) {
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
      let result;
      try {
        result = runtime.sendNativeMessage(SAFARI_NATIVE_APP_ID, message, callback);
      } catch {
        result = runtime.sendNativeMessage(message, callback);
      }
      if (result?.then) result.then((value) => finish(value), (error) => finish(undefined, error));
      else if (result !== undefined && result !== null) finish(result);
    } catch (error) {
      finish(undefined, error);
    }
  });
}
