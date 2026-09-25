import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARSER_FILES } from '../../../src/lib/site-parser-files.js';
import { SITE_LAYOUT_FIXTURES } from './site-layouts.fixtures.js';

// Daily check that every supported site still has the layout its parser
// expects. Runs the extension's own parser scripts (not a copy) against the
// live chapter pages seeded in site-layouts.fixtures.js. No extension build or
// account is involved, so the only thing that can fail here is a site change
// (or a seeded chapter that moved).

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src');
const parserSource = (
  await Promise.all(PARSER_FILES.map((file) => readFile(path.join(srcDir, file), 'utf8')))
).join('\n;\n');

// Sites that sit behind bot protection answer a datacenter runner with a
// challenge page instead of the chapter. That says nothing about their
// layout, so those runs are skipped (and named in the report), not failed.
const BLOCKED_STATUSES = new Set([401, 403, 429, 503, 520, 521, 522, 523, 524, 525, 526]);
const CHALLENGE_TITLE = /just a moment|attention required|access denied|verify you are human|security check/i;

test.describe.configure({ mode: 'parallel' });
test.use({
  // Some sites (Webnovel) forbid injected scripts in their CSP; the
  // extension's content scripts are exempt from page CSP, so match that.
  bypassCSP: true,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
});

function expectedValue(value) {
  return value instanceof RegExp ? expect.stringMatching(value) : value;
}

async function openChapter(page, url) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (error) {
    return { blocked: `navigation failed: ${error.message.split('\n')[0]}` };
  }

  const status = response?.status() ?? 0;
  if (BLOCKED_STATUSES.has(status)) return { blocked: `HTTP ${status}` };

  const title = await page.title().catch(() => '');
  if (CHALLENGE_TITLE.test(title)) return { blocked: `bot challenge ("${title}")` };

  return { status };
}

async function extractMetadata(page) {
  await page.evaluate(parserSource);
  return page.evaluate(() => globalThis.NovelTrackerPageMetadata.extractPageMetadata());
}

for (const site of SITE_LAYOUT_FIXTURES) {
  test.describe(site.site, () => {
    for (const novel of site.novels) {
      test(novel.url, async ({ page }) => {
        const opened = await openChapter(page, novel.url);
        test.skip(Boolean(opened.blocked), `${site.site} did not serve the chapter: ${opened.blocked}`);
        expect(opened.status, 'the seeded chapter should still exist').toBeLessThan(400);

        if (novel.ready) {
          await expect(page.locator(novel.ready).first()).toBeVisible({ timeout: 30_000 });
        }

        // Soft, so one run reports every element that went missing at once.
        for (const selector of site.layout) {
          await expect.soft(page.locator(selector).first(), `layout element ${selector}`).toBeAttached({
            timeout: 20_000
          });
        }

        // Pages that hydrate late report autoProgressReady: false until they
        // are ready; poll the same way the content script retries.
        let metadata;
        await expect
          .poll(async () => {
            metadata = await extractMetadata(page);
            return metadata?.autoProgressReady !== false;
          }, { timeout: 30_000 })
          .toBe(true);

        if (novel.unverified) {
          expect(metadata.novelHomeUrl).toBe(novel.novelHomeUrl);
          expect(metadata.title?.trim(), 'parsed title').toBeTruthy();
          expect(metadata.title).not.toBe('Untitled Novel');
          expect(metadata.lastReadChapterLabel?.trim(), 'parsed chapter label').toBeTruthy();
          return;
        }

        expect(metadata).toMatchObject({
          title: expectedValue(novel.title),
          novelHomeUrl: expectedValue(novel.novelHomeUrl),
          lastReadChapterLabel: expectedValue(novel.lastReadChapterLabel)
        });
      });
    }
  });
}
