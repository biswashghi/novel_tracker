#!/usr/bin/env node

import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const storeAssetsDir = path.join(rootDir, 'store-assets');
const originalsDir = path.join(storeAssetsDir, 'original');

const sourceImages = [
  'marquee-promo-tile-1400x560.jpg',
  'screenshot-popup-1280x800.jpg',
  'small-promo-tile-440x280.jpg',
];

const platformConfigs = [
  {
    name: 'macos',
    sizes: [{ width: 2880, height: 1800 }],
    suffix: 'macos-screenshot',
  },
  {
    name: 'ios',
    sizes: [{ width: 1284, height: 2778 }],
    suffix: 'ios-screenshot',
  },
  {
    name: 'ipad',
    sizes: [{ width: 2064, height: 2752 }],
    suffix: 'ipad-screenshot',
  },
];

function ensureOriginalsExist() {
  if (!existsSync(originalsDir)) {
    throw new Error(
      `Original source images directory does not exist: ${originalsDir}\n` +
        'Move the base JPGs into store-assets/original/ before running this script.'
    );
  }

  for (const file of sourceImages) {
    const sourcePath = path.join(originalsDir, file);
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing source image: ${sourcePath}`);
    }
  }
}

async function generateForPlatform(platform) {
  const { suffix, sizes } = platform;

  for (const sourceImage of sourceImages) {
    const sourcePath = path.join(originalsDir, sourceImage);

    for (const size of sizes) {
      const index = sourceImages.indexOf(sourceImage) + 1;
      const outputName = `${suffix}-${size.width}x${size.height}-${index}.jpg`;
      const outputPath = path.join(storeAssetsDir, outputName);

      await sharp(sourcePath)
        .resize(size.width, size.height, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .jpeg({ quality: 95, progressive: true })
        .toFile(outputPath);

      console.log(`✓ ${outputName} (${size.width}×${size.height})`);
    }
  }
}

async function main() {
  try {
    mkdirSync(storeAssetsDir, { recursive: true });
    ensureOriginalsExist();

    console.log('Generating App Store screenshot exports from store-assets/original/...\n');

    for (const platform of platformConfigs) {
      console.log(`Generating ${platform.name.toUpperCase()} screenshots...`);
      await generateForPlatform(platform);
      console.log('');
    }

    console.log('✅ App Store screenshots generated successfully.');
    console.log(`📁 Output directory: ${storeAssetsDir}`);
  } catch (error) {
    console.error('\n❌ Failed to generate App Store screenshots');
    console.error(error.message);
    process.exit(1);
  }
}

main();
