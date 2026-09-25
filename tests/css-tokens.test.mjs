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

test("every token used without a fallback is defined in tokens.css or the same stylesheet", async () => {
  // Tokens set from script (e.g. style.setProperty("--weeks")) carry a fallback.
  const definedIn = (css) => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const shared = definedIn(await readFile(new URL("tokens.css", srcDir), "utf8"));
  for (const name of stylesheets) {
    const css = await readFile(new URL(name, srcDir), "utf8");
    const defined = new Set([...shared, ...definedIn(css)]);
    const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((match) => match[1]));
    const missing = [...used].filter((token) => !defined.has(token));
    assert.deepEqual(missing, [], `${name} uses undefined ${missing.join(", ")}`);
  }
});

test("every extension page loads the shared tokens before its own stylesheet", async () => {
  for (const page of ["options.html", "popup.html"]) {
    const html = await readFile(new URL(page, srcDir), "utf8");
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
    assert.equal(links[0], "tokens.css", `${page} loads ${links.join(", ")}`);
  }
});

test("the light and dark palettes define the same colour tokens", async () => {
  const css = await readFile(new URL("tokens.css", srcDir), "utf8");
  const block = (start) => {
    const open = css.indexOf("{", css.indexOf(start)) + 1;
    return new Set([...css.slice(open, css.indexOf("}", open)).matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  };
  const dark = block(':root[data-theme="dark"]');
  const light = block(":root {");
  // Shape, motion and type tokens are theme-independent; every colour the
  // light palette sets must have a dark value too.
  const themeless = /^--(radius|ease|fast|base|slow|font)/;
  const missing = [...light].filter((token) => !themeless.test(token) && !dark.has(token) && !/^--(fill|fill-hover)$/.test(token));
  assert.deepEqual(missing, [], `dark palette lacks ${missing.join(", ")}`);
});
