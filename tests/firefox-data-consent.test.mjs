import assert from "node:assert/strict";
import test from "node:test";
import { requireFirefoxSyncDataConsent } from "../src/lib/firefox-data-consent.js";

test("non-Firefox builds do not request Firefox data consent", async () => {
  let requests = 0;
  await requireFirefoxSyncDataConsent({
    runtime: { getManifest: () => ({ manifest_version: 3 }) },
    permissions: { request: async () => { requests += 1; return true; } }
  });
  assert.equal(requests, 0);
});

test("Firefox requests exactly the optional sync data categories", async () => {
  const optional = ["authenticationInfo", "websiteContent"];
  let requested;
  await requireFirefoxSyncDataConsent({
    runtime: {
      getManifest: () => ({
        browser_specific_settings: {
          gecko: { data_collection_permissions: { required: ["none"], optional } }
        }
      })
    },
    permissions: {
      request: async (permissions) => { requested = permissions; return true; }
    }
  });
  assert.deepEqual(requested, { data_collection: optional });
});

test("Firefox sign-in stops when optional sync data consent is denied", async () => {
  await assert.rejects(
    () => requireFirefoxSyncDataConsent({
      runtime: {
        getManifest: () => ({
          browser_specific_settings: {
            gecko: { data_collection_permissions: { required: ["none"], optional: ["browsingActivity"] } }
          }
        })
      },
      permissions: { request: async () => false }
    }),
    /permission is required/
  );
});
