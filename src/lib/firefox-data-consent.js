import { getExtensionApi } from "./extension-api.js";

export async function requireFirefoxSyncDataConsent(api = getExtensionApi()) {
  const optionalData = api?.runtime?.getManifest?.()?.browser_specific_settings?.gecko
    ?.data_collection_permissions?.optional;

  // Chrome and Safari do not use Firefox's built-in data consent API.
  if (!Array.isArray(optionalData) || optionalData.length === 0) return;
  if (!api?.permissions?.request) {
    throw new Error("Firefox data-sharing permission is unavailable");
  }

  // This call is deliberately the first awaited operation in the click path.
  // Firefox requires permissions.request() to originate from a user gesture.
  const granted = await api.permissions.request({ data_collection: optionalData });
  if (!granted) {
    throw new Error("Data-sharing permission is required to sign in and synchronize");
  }
}
