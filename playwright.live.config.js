import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.js';

export default defineConfig({
  ...baseConfig,
  testDir: './tests/e2e/live',
  testIgnore: [],
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ]
});
