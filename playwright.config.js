import { defineConfig, devices } from '@playwright/test';

// See docs/testing-locally.md. `extension-smoke.spec.js` is a fast
// mocked-`chrome` component test with no extra requirements.
// `library-flow.spec.js` / `auto-progress.spec.js` load the real packaged
// `dist/` extension (run `npm run build` first) via
// `tests/e2e/fixtures/extension.js`, but are still local-only.
// `sync-flow.spec.js` / `merge-conflict.spec.js` / `account-deletion.spec.js`
// also load the real extension AND require `npm run e2e:stack:up` +
// `npm run build:e2e` first, since they sign in and sync against
// infra/docker-compose.yml.
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/live/**'],
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  // account-deletion.spec.js, merge-conflict.spec.js, and sync-flow.spec.js
  // all sign into the *same* seeded Keycloak account (docs/testing-locally.md)
  // and mutate/read the same rows through the real local API — running two
  // of those spec files concurrently (workers > 1) races them against each
  // other's cloud state (e.g. account-deletion wiping data mid-flight for
  // whichever other spec is signed into that account at the time), not just
  // contending for CPU. Keep this at 1 so those specs never overlap; a
  // per-spec seeded user would let this go back up, but isn't worth the
  // realm-config complexity for this suite's size.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    // Headless is fine for extension specs on Chrome's *new* headless mode
    // (112+), which is the real browser rather than the old headless shell —
    // --load-extension works there. It only had to be headed under the old
    // shell, which could not load extensions at all. Verified: all nine specs
    // pass headless, including the ones that drive Keycloak's real login tab
    // via chrome.identity.launchWebAuthFlow. Use `npm run test:e2e:headed` to
    // watch a run.
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
      },
    },
  ],
});
