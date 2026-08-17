import { getExtensionApi } from "./extension-api.js";
import { sendNativeMessage } from "./safari-native-messaging.js";

export const SAFARI_OAUTH_REDIRECT_URI = "noveltracker://oauth/callback";

function webExtensionIdentityPlatform(identity) {
  return {
    kind: "web-extension-identity",
    redirectUri(path) {
      return identity.getRedirectURL(path);
    },
    authorize(url) {
      return identity.launchWebAuthFlow({ url, interactive: true });
    }
  };
}

function safariNativePlatform(runtime) {
  async function request(message) {
    const response = await sendNativeMessage(runtime, message);
    if (response?.error) throw new Error(response.error);
    return response;
  }
  return {
    kind: "safari-native",
    redirectUri() {
      return SAFARI_OAUTH_REDIRECT_URI;
    },
    async authorize(url) {
      const response = await request({
        type: "novel-tracker.oauth.authorize",
        authorizationUrl: url,
        callbackScheme: "noveltracker"
      });
      if (!response?.callbackUrl) throw new Error("Safari did not return an authorization callback");
      return response.callbackUrl;
    },
    async sharedSession() {
      return (await request({ type: "novel-tracker.auth.get" }))?.session || null;
    },
    async storeSharedSession(session) {
      await request({ type: "novel-tracker.auth.store", session });
    },
    async clearSharedSession() {
      await request({ type: "novel-tracker.auth.clear" });
    }
  };
}

export function getAuthPlatform(api = getExtensionApi()) {
  if (api?.identity?.getRedirectURL && api.identity?.launchWebAuthFlow) {
    return webExtensionIdentityPlatform(api.identity);
  }
  if (api?.runtime?.sendNativeMessage) return safariNativePlatform(api.runtime);
  throw new Error("This browser does not provide an interactive authentication adapter");
}
