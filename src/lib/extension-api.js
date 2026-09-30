export function getExtensionApi() {
  return globalThis.browser || globalThis.chrome || null;
}

export function getStorageLocal() {
  return getExtensionApi()?.storage?.local || null;
}

// Safari serves extension pages from safari-web-extension://, which is the
// most direct way to tell it apart: it also answers to `chrome`, and
// user-agent sniffing breaks with every Safari release.
export function isSafariExtension(api = getExtensionApi()) {
  try {
    return /^safari-web-extension:/.test(api?.runtime?.getURL?.("") || "");
  } catch {
    return false;
  }
}
