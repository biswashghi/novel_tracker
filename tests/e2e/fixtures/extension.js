import { test as base, chromium, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');
export const DIST_DIR = path.join(projectRoot, 'dist');

/**
 * Extends Playwright's `test` with a real, packaged-extension-loading
 * Chromium context — not a mocked `chrome` global. Requires `npm run build`
 * or `npm run build:e2e` to have produced `dist/` first.
 *
 * Chromium only: Playwright does not support loading unpacked WebExtensions
 * in Firefox or Safari. See docs/testing-locally.md.
 */
/**
 * Forwards a page's/service worker's console output and uncaught errors to
 * the test runner's own stdout, prefixed so it's attributable when multiple
 * devices/pages are live at once (e.g. merge-conflict.spec.js's two
 * contexts). This is what actually surfaces background-service-worker
 * failures (a rejected sign-in, a dropped sendMessage, a failed sync POST)
 * that would otherwise only show up as an inscrutable UI-side timeout —
 * this file's real-extension specs have no mocked `chrome` global to log
 * through instead, unlike extension-smoke.spec.js.
 */
export function logConsole(target, label) {
  target.on('console', (msg) => console.log(`[${label}]`, msg.type(), msg.text()));
  target.on('pageerror', (err) => console.log(`[${label}] pageerror:`, err.message));
}

export const test = base.extend({
  context: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'novel-tracker-e2e-'));
    // Chrome's new headless mode loads extensions; see playwright.config.js.
    // --headed is still available via `npm run test:e2e:headed`.
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: [
        `--disable-extensions-except=${DIST_DIR}`,
        `--load-extension=${DIST_DIR}`,
        '--no-first-run'
      ]
    });
    context.on('page', (page) => logConsole(page, 'page'));
    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    await use(new URL(serviceWorker.url()).host);
  },

  serviceWorker: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    logConsole(serviceWorker, 'background');
    await use(serviceWorker);
  }
});

export { expect };

/**
 * Guards the sign-in/sync specs against the single most likely setup
 * mistake: running `npm run build` (production) instead of
 * `npm run e2e:stack:up && npm run build:e2e` first. Without this, a sign-in
 * click opens *real* Google OAuth instead of the local Keycloak realm's own
 * login form, and the spec just times out 20+ seconds later on a
 * `#username` locator that was never going to appear — confusing to debug.
 * Call this in a `test.beforeAll` in any spec that calls `signIn()`.
 */
export async function assertLocalStackConfig() {
  const configPath = path.join(DIST_DIR, 'lib', 'config.js');
  let contents;
  try {
    contents = await readFile(configPath, 'utf8');
  } catch {
    throw new Error(`Could not read ${configPath}. Run "npm run build:e2e" first (see docs/testing-locally.md).`);
  }
  if (!contents.includes('localhost:8793')) {
    throw new Error(
      `${configPath} isn't pointed at the local stack (still has the production issuer). ` +
      'Run "npm run e2e:stack:up && npm run build:e2e" before this spec — plain "npm run build" ' +
      'builds against production and will send sign-in to real Google OAuth. See docs/testing-locally.md.'
    );
  }
}

export function extensionUrl(extensionId, pagePath) {
  return `chrome-extension://${extensionId}/${pagePath}`;
}

/**
 * Routes `https://<hostname>/**` in `context` to return `html` for any
 * request, the same way a real chapter page would look to the extension's
 * content script / site parsers. Mirrors the fixture technique the original
 * mocked-chrome smoke test used, but here it fronts a page the real,
 * unmocked extension will actually parse.
 */
export async function mockSitePage(context, url, html) {
  const origin = new URL(url).origin;
  await context.route(`${origin}/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
}

/**
 * Playwright cannot simulate a real toolbar-icon click producing the actual
 * action-popup surface — opening popup.html as a normal page instead makes
 * *that tab* the browser's "active" tab, which would make
 * `chrome.tabs.query({active:true})` report the popup itself rather than
 * the chapter tab a real user would have been looking at. This finds the
 * real tab for `tabUrl` (via the service worker's unmocked `chrome.tabs`)
 * and installs a narrow `chrome.tabs.query` override — active-tab lookups
 * only — before the popup/options page loads. Every other extension API
 * (storage, scripting, runtime messaging to the real background service
 * worker) stays real.
 */
export async function stubActiveTab(page, serviceWorker, tabUrl) {
  // Immediately after a fresh page navigation, the MV3 service worker can
  // briefly be between registration and having its API bindings ready;
  // retry a few times rather than flake on that race.
  let tab;
  for (let attempt = 0; attempt < 10 && !tab; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 200));
    [tab] = await serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return tabs.filter((candidate) => candidate.url === url);
    }, tabUrl);
  }
  if (!tab) throw new Error(`No open tab matches ${tabUrl}; navigate to it before opening the popup/options page`);

  await page.addInitScript(({ tabId, url }) => {
    const realQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (queryInfo) => {
      if (queryInfo && queryInfo.active) return [{ id: tabId, url, active: true }];
      return realQuery(queryInfo);
    };
  }, { tabId: tab.id, url: tab.url });

  return tab;
}
