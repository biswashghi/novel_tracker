import test from "node:test";
import assert from "node:assert/strict";
import { isSafariExtension } from "../src/lib/extension-api.js";

const apiServing = (base) => ({ runtime: { getURL: (path) => `${base}${path}` } });

test("Safari is recognised by its extension URL scheme", () => {
  assert.equal(isSafariExtension(apiServing("safari-web-extension://ABC-123/")), true);
});

test("Chrome and Firefox are not Safari", () => {
  assert.equal(isSafariExtension(apiServing("chrome-extension://abcdef/")), false);
  assert.equal(isSafariExtension(apiServing("moz-extension://1234/")), false);
});

test("a missing or throwing runtime is not Safari", () => {
  assert.equal(isSafariExtension(null), false);
  assert.equal(isSafariExtension({}), false);
  assert.equal(isSafariExtension({ runtime: { getURL: () => { throw new Error("invalidated"); } } }), false);
});
