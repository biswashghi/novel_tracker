import { getExtensionApi } from "./extension-api.js";

export const SAFARI_NATIVE_APP_ID = "app.noveltracker.extension";
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
  return {
    kind: "safari-native",
    redirectUri() {
      return SAFARI_OAUTH_REDIRECT_URI;
    },
    async authorize(url) {
      const message = {
        type: "novel-tracker.oauth.authorize",
        authorizationUrl: url,
        callbackScheme: "noveltracker"
      };
      const response = await sendNative(runtime, message);
      if (response?.error) throw new Error(response.error);
      if (!response?.callbackUrl) throw new Error("Safari did not return an authorization callback");
      return response.callbackUrl;
    }
  };
}

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
      const result = runtime.sendNativeMessage(SAFARI_NATIVE_APP_ID, message, callback);
      if (result?.then) result.then((value) => finish(value), (error) => finish(undefined, error));
    } catch (error) {
      finish(undefined, error);
    }
  });
}

export function getAuthPlatform(api = getExtensionApi()) {
  if (api?.identity?.getRedirectURL && api.identity?.launchWebAuthFlow) {
    return webExtensionIdentityPlatform(api.identity);
  }
  if (api?.runtime?.sendNativeMessage) {
    return safariNativePlatform(api.runtime);
  }
  throw new Error("This browser does not provide an interactive authentication adapter");
}
