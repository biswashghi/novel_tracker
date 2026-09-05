import test from "node:test";
import assert from "node:assert/strict";
import { getApiClientIdentity } from "../src/lib/api-client-identity.js";

function restore(name, value) {
  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;
}

test("API client identity distinguishes Chrome, Firefox, and Safari builds", () => {
  const previousChrome = globalThis.chrome;
  const previousBrowser = globalThis.browser;
  try {
    delete globalThis.browser;
    globalThis.chrome = { runtime: { getManifest: () => ({ version: "1.0.2" }) }, identity: {} };
    assert.deepEqual(getApiClientIdentity(), { version: "1.0.2", platform: "chrome" });

    delete globalThis.chrome;
    globalThis.browser = {
      runtime: { getManifest: () => ({ version: "1.0.3" }), getBrowserInfo() {} },
      identity: {}
    };
    assert.deepEqual(getApiClientIdentity(), { version: "1.0.3", platform: "firefox" });

    globalThis.browser = {
      runtime: { getManifest: () => ({ version: "1.0.4" }), sendNativeMessage() {} }
    };
    assert.deepEqual(getApiClientIdentity(), { version: "1.0.4", platform: "safari" });
  } finally {
    restore("chrome", previousChrome);
    restore("browser", previousBrowser);
  }
});
