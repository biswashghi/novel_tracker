#!/usr/bin/env node
// Captures App Store screenshots from the iOS Simulator.
//
// Replaces the old path, which upscaled `marquee-promo-tile` and
// `small-promo-tile` into "screenshots" — App Store review rejected exactly
// that under guideline 2.3.3 ("screenshots should highlight the app's core
// concept... marketing materials that do not reflect the UI are not
// appropriate"). Everything here is a real capture of the real UI.
//
// Devices are chosen so both required sizes come out native, with no rescaling:
//   iPad Pro 13-inch  -> 2064x2752 (13-inch iPad slot)
//   iPhone 14 Plus    -> 1284x2778 (6.5-inch iPhone slot)
//
// Usage:
//   npm run build            # dist/ must exist and be a production build
//   node scripts/capture-appstore-screenshots.mjs [--keep-devices]
//
// The container app is captured from a simulator build; the library and popup
// are served over loopback and captured in Safari, because seeding extension
// storage and opening Safari's extension control are not scriptable. These use
// the shipping HTML, CSS, and JavaScript — only storage, page metadata, and
// extension messaging are stubbed to make the captures deterministic.
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const outDir = path.join(rootDir, "store-assets");
const PORT = 8899;
const BUNDLE_ID = "app.noveltracker.extension";
const keepDevices = process.argv.includes("--keep-devices");

const DEVICES = [
  {
    key: "ipad",
    name: "iPad Pro 13-inch (M5)",
    deviceType: null, // Expected to exist already; iPad runtimes are large.
    size: "2064x2752",
    prefix: "ipad-screenshot"
  },
  {
    key: "iphone",
    // Created on demand: the 6.5-inch slot wants 1284x2778, which the newer
    // 17-series simulators do not produce.
    name: "NT-appstore-6.5in",
    deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-14-Plus",
    size: "1284x2778",
    prefix: "ios-screenshot"
  }
];

// Library first, filtering second, saving a chapter third, and the app screen
// last: Apple requires the majority to show the app in use and weights the
// earliest ones most.
const SHOTS = [
  { name: "library", url: `http://localhost:${PORT}/seed.html` },
  { name: "search", url: `http://localhost:${PORT}/capture.html?q=cultivation` },
  { name: "popup", url: `http://localhost:${PORT}/chapter.html` },
  { name: "app", app: true }
];

const day = 86400000;

function demoLibrary() {
  const now = Date.now();
  const at = (d) => new Date(now - d * day).toISOString();
  const novel = (id, title, site, home, chapter, label, status, tags, rating, readDays) => ({
    id,
    title,
    sourceSite: site,
    novelHomeUrl: home,
    lastReadChapterUrl: `${home}/chapter-${chapter}`,
    lastReadChapterLabel: label,
    coverImageUrl: "",
    status,
    tags,
    notes: "",
    rating,
    createdAt: at(readDays[0] + 30),
    updatedAt: at(readDays.at(-1)),
    chapterHistory: readDays.map((d, i) => ({
      url: `${home}/chapter-${chapter - readDays.length + i + 1}`,
      label: `Chapter ${chapter - readDays.length + i + 1}`,
      readAt: at(d)
    }))
  });

  return [
    novel("n1", "The Lantern Archivist", "www.royalroad.com", "https://www.royalroad.com/fiction/44001/the-lantern-archivist", 212, "Chapter 212: Ash and Ledger", "active", ["progression", "slow burn"], 5, [6, 4, 2, 0]),
    novel("n2", "Tidewrought", "www.scribblehub.com", "https://www.scribblehub.com/series/88120/tidewrought", 97, "Chapter 97: The Salt Court", "active", ["xianxia"], 4, [9, 5, 1]),
    novel("n3", "Grave of the Second Sun", "novelbin.com", "https://novelbin.com/b/grave-of-the-second-sun", 340, "Chapter 340: Interlude", "active", ["cultivation", "long"], 4, [12, 7, 3]),
    novel("n4", "A Quiet Apprenticeship", "creativenovels.com", "https://creativenovels.com/novel/a-quiet-apprenticeship", 58, "Chapter 58: Winter Terms", "paused", ["cozy"], 3, [26, 21]),
    novel("n5", "Ninefold Cartography", "www.wuxiaworld.com", "https://www.wuxiaworld.com/novel/ninefold-cartography", 415, "Chapter 415: The Last Map", "completed", ["finished"], 5, [40, 33, 30]),
    novel("n6", "Hollow Signal", "chikari.moe", "https://chikari.moe/series/hollow-signal", 24, "Chapter 24: Carrier Tone", "active", ["sci-fi"], 4, [16, 11, 8])
  ];
}

// options.js talks to the background service worker and would otherwise render
// an error banner and the wrong signed-out button states. Storage is left
// undefined so storage.js falls back to localStorage and reads the seed.
function captureHarness(optionsHtml) {
  const stub = `    <meta name="apple-mobile-web-app-capable" content="yes">
    <script>
      window.browser = {
        runtime: {
          sendMessage: async (message) =>
            message?.type === "novel-tracker:account-status"
              ? { account: { signedIn: false }, sync: {} }
              : { ok: true }
        }
      };
      addEventListener("load", () => {
        const q = new URLSearchParams(location.search).get("q");
        if (!q) return;
        setTimeout(() => {
          const search = document.querySelector("#search");
          if (!search) return;
          search.value = q;
          search.dispatchEvent(new Event("input", { bubbles: true }));
        }, 600);
      });
    </script>
`;
  return optionsHtml.replace("</head>", stub + "</head>");
}

function seedPage(novels) {
  return `<!doctype html><meta charset="utf-8"><title>Seeding</title><script>
localStorage.setItem("novel-tracker:novels", ${JSON.stringify(JSON.stringify(novels))});
localStorage.removeItem("novel-tracker:sync-state");
location.replace("capture.html");
</script>`;
}

function popupHarness(popupHtml) {
  const metadata = {
    title: "The Lantern Archivist",
    sourceSite: "www.royalroad.com",
    novelHomeUrl: "https://www.royalroad.com/fiction/44001/the-lantern-archivist",
    lastReadChapterUrl: "https://www.royalroad.com/fiction/44001/the-lantern-archivist/chapter-213",
    lastReadChapterLabel: "Chapter 213: A Door of Embers",
    coverImageUrl: "",
    status: "active"
  };
  const stub = `    <script>
      window.browser = {
        tabs: { query: async () => [{ id: 1, url: ${JSON.stringify(metadata.lastReadChapterUrl)} }] },
        scripting: {
          executeScript: async (request) => request.func
            ? [{ result: ${JSON.stringify(metadata)} }]
            : []
        },
        storage: {
          local: {
            get: async () => ({}),
            set: async () => undefined
          }
        },
        runtime: {
          sendMessage: async () => ({ ok: true }),
          openOptionsPage: async () => undefined
        }
      };
    </script>
`;
  return popupHtml.replace("</head>", stub + "</head>");
}

function chapterPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>The Lantern Archivist — Chapter 213</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      background: #f7f2ea;
      color: #2b2926;
      font-family: Georgia, "Times New Roman", serif;
    }
    article {
      width: min(760px, calc(100% - 52px));
      margin: 0 auto;
      padding: 64px 0 180px;
    }
    .eyebrow {
      color: #a55731;
      font: 800 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    h1 { margin: 12px 0 6px; font-size: clamp(34px, 5vw, 58px); line-height: 1; }
    h2 { margin: 0 0 38px; color: #7a6c61; font-size: 20px; font-weight: 400; }
    p { font-size: 19px; line-height: 1.85; }
    .scrim {
      position: fixed;
      inset: 0;
      background: rgba(32, 27, 23, .28);
      backdrop-filter: blur(1px);
    }
    .extension-popup {
      position: fixed;
      z-index: 2;
      top: 22px;
      right: 26px;
      width: 394px;
      height: min(730px, calc(100vh - 44px));
      border: 0;
      border-radius: 18px;
      background: #f2ede5;
      box-shadow: 0 26px 80px rgba(29, 21, 15, .35);
    }
    @media (max-width: 600px) {
      article { width: calc(100% - 36px); padding-top: 42px; }
      .extension-popup {
        top: 12px;
        right: 12px;
        width: 390px;
        max-width: calc(100vw - 24px);
        height: min(710px, calc(100vh - 24px));
        border-radius: 16px;
      }
    }
  </style>
</head>
<body>
  <article>
    <div class="eyebrow">The Lantern Archivist</div>
    <h1>Chapter 213</h1>
    <h2>A Door of Embers</h2>
    <p>The archive door had never opened for fire. Mira rested her palm against the warm brass seal and listened as the shelves whispered her name.</p>
    <p>Beyond the threshold, a single lantern burned without oil, throwing long copper shadows across a ledger that had been waiting for her.</p>
  </article>
  <div class="scrim" aria-hidden="true"></div>
  <iframe class="extension-popup" src="popup-frame.html" title="Novel Tracker extension popup"></iframe>
</body>
</html>`;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json"
};

async function startServer(extra) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://localhost:${PORT}`);
    const name = url.pathname.replace(/^\//, "") || "index.html";
    if (extra[name]) {
      response.writeHead(200, { "content-type": MIME[".html"] });
      return response.end(extra[name]);
    }
    const file = path.join(distDir, name);
    if (!file.startsWith(distDir) || !existsSync(file)) {
      response.writeHead(404);
      return response.end("not found");
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    response.end(await readFile(file));
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  return server;
}

function simctl(args, options = {}) {
  return execFileSync("xcrun", ["simctl", ...args], { encoding: "utf8", ...options });
}

function bootedDevices() {
  return simctl(["list", "devices", "booted"]);
}

async function ensureDevice(device) {
  const known = simctl(["list", "devices"]);
  if (!known.includes(device.name)) {
    if (!device.deviceType) {
      throw new Error(`Simulator "${device.name}" is not installed. Add it in Xcode, or pass a device type.`);
    }
    simctl(["create", device.name, device.deviceType]);
    console.log(`Created simulator ${device.name}`);
  }
  // Always start from a clean UI session. In particular, an unfinished
  // ASWebAuthenticationSession can otherwise remain above Safari and leak an
  // authorization prompt into every subsequent App Store screenshot.
  if (bootedDevices().includes(device.name)) simctl(["shutdown", device.name]);
  simctl(["boot", device.name]);
  // simctl reports booted well before Safari and SpringBoard are usable.
  await new Promise((resolve) => setTimeout(resolve, 12_000));
}

async function capture(device, file) {
  await mkdir(outDir, { recursive: true });
  simctl(["io", device.name, "screenshot", file], { stdio: "pipe" });
  const meta = await sharp(file).metadata();
  if (`${meta.width}x${meta.height}` !== device.size) {
    throw new Error(`${device.name} produced ${meta.width}x${meta.height}, expected ${device.size}. App Store slots require exact dimensions.`);
  }
}

async function main() {
  if (!existsSync(path.join(distDir, "options.html"))) {
    throw new Error("dist/ is missing. Run `npm run build` first (a production build, not --env=local).");
  }

  const appPath = process.env.NOVEL_TRACKER_APP_PATH;
  if (appPath && !existsSync(appPath)) throw new Error(`NOVEL_TRACKER_APP_PATH does not exist: ${appPath}`);

  const optionsHtml = await readFile(path.join(distDir, "options.html"), "utf8");
  const popupHtml = await readFile(path.join(distDir, "popup.html"), "utf8");
  const server = await startServer({
    "capture.html": captureHarness(optionsHtml),
    "seed.html": seedPage(demoLibrary()),
    "chapter.html": chapterPage(),
    "popup-frame.html": popupHarness(popupHtml)
  });

  try {
    for (const device of DEVICES) {
      await ensureDevice(device);
      let index = 0;

      for (const shot of SHOTS) {
        index += 1;
        const target = path.join(outDir, `${device.prefix}-${device.size}-${index}.jpg`);
        const raw = path.join(outDir, `.${device.prefix}-${index}.png`);

        if (shot.app) {
          if (!appPath) {
            console.warn(`Skipping the app screenshot for ${device.name}: set NOVEL_TRACKER_APP_PATH to a simulator build of Novel Tracker.app.`);
            continue;
          }
          simctl(["install", device.name, appPath]);
          simctl(["launch", device.name, BUNDLE_ID], { stdio: "pipe" });
        } else {
          simctl(["openurl", device.name, shot.url]);
        }
        await new Promise((resolve) => setTimeout(resolve, 6000));

        await capture(device, raw);
        await sharp(raw).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(target);
        await run("rm", ["-f", raw]);
        console.log(`${path.relative(rootDir, target)}  ${device.size}  (${shot.name})`);
      }

      if (!keepDevices && device.deviceType) {
        simctl(["shutdown", device.name]);
        simctl(["delete", device.name]);
      }
    }
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
