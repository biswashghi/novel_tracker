import { getExtensionApi } from "./extension-api.js";

export function getApiClientIdentity() {
  const api = getExtensionApi();
  const version = api?.runtime?.getManifest?.()?.version || "unknown";
  let platform = "chrome";
  if (!api?.identity && api?.runtime?.sendNativeMessage) platform = "safari";
  else if (globalThis.browser?.runtime?.getBrowserInfo) platform = "firefox";
  return { version, platform };
}
