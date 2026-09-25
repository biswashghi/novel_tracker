import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const srcDir = new URL("../src/", import.meta.url);
const stylesheets = (await readdir(srcDir)).filter((name) => name.endsWith(".css"));

test("no color token is defined in terms of itself", async () => {
  // `--x: var(--x)` is invalid at computed-value time, so everything using the
  // token silently falls back (a transparent background, say) in that theme.
  for (const name of stylesheets) {
    const css = await readFile(new URL(name, srcDir), "utf8");
    const cycles = [...css.matchAll(/(--[\w-]+)\s*:\s*[^;]*var\(\s*\1\s*[,)]/g)].map((match) => match[1]);
    assert.deepEqual(cycles, [], `${name} defines ${cycles.join(", ")} in terms of itself`);
  }
});

test("every token used without a fallback is defined in the same stylesheet", async () => {
  // Tokens set from script (e.g. style.setProperty("--weeks")) carry a fallback.
  for (const name of stylesheets) {
    const css = await readFile(new URL(name, srcDir), "utf8");
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((match) => match[1]));
    const missing = [...used].filter((token) => !defined.has(token));
    assert.deepEqual(missing, [], `${name} uses undefined ${missing.join(", ")}`);
  }
});
