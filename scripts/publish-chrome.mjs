#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const required = [
  'CHROME_WEB_STORE_EXTENSION_ID',
  'CHROME_WEB_STORE_CLIENT_ID',
  'CHROME_WEB_STORE_CLIENT_SECRET',
  'CHROME_WEB_STORE_REFRESH_TOKEN',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing Chrome Web Store configuration: ${missing.join(', ')}`);
  process.exit(1);
}

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: node scripts/publish-chrome.mjs <path-to-zip>');
  process.exit(1);
}

const extensionId = process.env.CHROME_WEB_STORE_EXTENSION_ID;
const clientId = process.env.CHROME_WEB_STORE_CLIENT_ID;
const clientSecret = process.env.CHROME_WEB_STORE_CLIENT_SECRET;
const refreshToken = process.env.CHROME_WEB_STORE_REFRESH_TOKEN;

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }),
});

if (!tokenResponse.ok) {
  const errorText = await tokenResponse.text();
  throw new Error(`Failed to obtain Chrome Web Store access token: ${tokenResponse.status} ${errorText}`);
}

const tokenData = await tokenResponse.json();
const accessToken = tokenData.access_token;
if (!accessToken) {
  throw new Error('Chrome Web Store token response did not include an access token.');
}

const zipBuffer = await readFile(zipPath);

const uploadResponse = await fetch(
  `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}?uploadType=media`,
  {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/zip',
    },
    body: zipBuffer,
  },
);

const uploadText = await uploadResponse.text();
if (!uploadResponse.ok) {
  throw new Error(`Chrome Web Store upload failed: ${uploadResponse.status} ${uploadText}`);
}

const publishResponse = await fetch(
  `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  },
);

const publishText = await publishResponse.text();
if (!publishResponse.ok) {
  throw new Error(`Chrome Web Store publish failed: ${publishResponse.status} ${publishText}`);
}

console.log(`Published Chrome Web Store package: ${zipPath}`);
console.log(publishText);
