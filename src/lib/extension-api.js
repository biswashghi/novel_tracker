export function getExtensionApi() {
  return globalThis.browser || globalThis.chrome || null;
}

export function getStorageLocal() {
  return getExtensionApi()?.storage?.local || null;
}
