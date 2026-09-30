#!/usr/bin/env node
// Captures App Store screenshots: iPhone and iPad from the iOS Simulator, and
// Mac from headless Chromium.
//
// Replaces the old path, which upscaled `marquee-promo-tile` and
// `small-promo-tile` into "screenshots" — App Store review rejected exactly
// that under guideline 2.3.3 ("screenshots should highlight the app's core
// concept... marketing materials that do not reflect the UI are not
// appropriate"). Everything here is a real capture of the real UI.
//
// Devices are chosen so every required size comes out native, with no rescaling:
//   iPad Pro 13-inch  -> 2064x2752 (13-inch iPad slot)
//   iPhone 14 Plus    -> 1284x2778 (6.5-inch iPhone slot)
//   Mac 1440x900 @2x  -> 2880x1800 (Mac slot)
//
// Output goes to store-assets/app-store/{ios,ipad,macos}/NN-<shot>.jpg, in
// upload order.
//
// Usage:
//   npm run build            # dist/ must exist and be a production build
//   node scripts/capture-appstore-screenshots.mjs [--device=ipad|iphone|mac] [--keep-devices]
//   node scripts/capture-appstore-screenshots.mjs --serve   # preview the harness pages
//
// The container app is captured from a simulator build (set
// NOVEL_TRACKER_APP_PATH); the library and popup are served over loopback and
// captured in Safari, because seeding extension storage and opening Safari's
// extension control are not scriptable. These use the shipping HTML, CSS, and
// JavaScript — only storage, page metadata, and extension messaging are
// stubbed, and URL parameters stand in for the taps that open history or the
// edit form, to make the captures deterministic.
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distDir = path.join(rootDir, "dist");
const outDir = path.join(rootDir, "store-assets", "app-store");
const PORT = 8899;
const ORIGIN = `http://localhost:${PORT}`;
const BUNDLE_ID = "app.noveltracker.extension";
const keepDevices = process.argv.includes("--keep-devices");
const serveOnly = process.argv.includes("--serve");
const deviceKey = process.argv
  .find((argument) => argument.startsWith("--device="))
  ?.split("=")[1];

const DEVICES = [
  {
    key: "ipad",
    name: "NT-appstore-13in",
    deviceType:
      "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB",
    size: "2064x2752",
    folder: "ipad",
  },
  {
    key: "iphone",
    // Created on demand: the 6.5-inch slot wants 1284x2778, which the newer
    // 17-series simulators do not produce.
    name: "NT-appstore-6.5in",
    deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-14-Plus",
    size: "1284x2778",
    folder: "ios",
  },
  {
    key: "mac",
    browser: true,
    viewport: { width: 1440, height: 900 },
    size: "2880x1800",
    folder: "macos",
  },
];
const devicesToCapture = deviceKey
  ? DEVICES.filter((device) => device.key === deviceKey)
  : DEVICES;

if (deviceKey && devicesToCapture.length === 0) {
  throw new Error(
    `Unknown --device=${deviceKey}. Use --device=ipad, --device=iphone, or --device=mac.`,
  );
}

// Library first and saving a chapter second: Apple requires the majority to
// show the app in use and weights the earliest ones most. The Mac has no
// container-app shot (the extension is the product there), so it closes on the
// popup in dark mode instead. Every path must differ from the one before it,
// since that is how the open tab knows to move on.
//
// On iPhone, Safari presents the popup as a system sheet with its own title bar
// that covers Safari's toolbars, which a page cannot draw over. That slot is
// captured by hand instead (open a chapter in the simulator, tap the page menu,
// then Novel Tracker, swipe the sheet up, and `xcrun simctl io <device>
// screenshot`), and this script leaves the file alone.
const SHOTS = [
  { name: "library", path: "capture.html" },
  { name: "popup", path: "chapter.html", manual: ["iphone"] },
  { name: "history", path: "capture.html?history=n1" },
  { name: "search", path: "capture.html?q=cultivation" },
  // The stats and heatmap already show in the wide library shots. A phone
  // lists the novels first and the stats below them, so scroll down to those.
  { name: "activity", path: "capture.html?scroll=stats-bar", only: ["iphone"] },
  { name: "continue", path: "chapter.html?continue", only: ["ipad", "mac"] },
  { name: "edit", path: "capture.html?edit=n2" },
  { name: "dark", path: "capture.html?dark", dark: true },
  { name: "app", app: true, only: ["ipad", "iphone"] },
  { name: "popup-dark", path: "chapter.html?dark", dark: true, only: ["mac"] },
];

const day = 86400000;

// A small seeded PRNG so every run produces the same library, streak, and
// heatmap.
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// Days ago on which chapters were read, oldest first. `recentDays` guarantees
// the most recent run of days (the streak); the rest are sparser.
function readingDays(seed, { spanDays, density, recentDays = 0, perDay = 2 }) {
  const next = random(seed);
  const days = [];
  for (let d = spanDays; d >= 0; d -= 1) {
    const reading = d < recentDays || next() < density;
    if (!reading) continue;
    const count = 1 + Math.floor(next() * perDay);
    for (let i = 0; i < count; i += 1) days.push(d + (count - i) / (count + 2));
  }
  return days;
}

function demoLibrary() {
  const now = Date.now();
  const at = (d) => new Date(now - d * day).toISOString();
  const novel = ({
    id,
    title,
    site,
    home,
    chapter,
    label,
    status,
    tags,
    rating,
    notes = "",
    days,
  }) => ({
    id,
    title,
    sourceSite: site,
    novelHomeUrl: home,
    lastReadChapterUrl: `${home}/chapter-${chapter}`,
    lastReadChapterLabel: label,
    coverImageUrl: `${ORIGIN}/covers/${id}.svg`,
    status,
    tags,
    notes,
    rating,
    createdAt: at(days[0] + 2),
    updatedAt: at(days.at(-1)),
    chapterHistory: days.map((d, i) => {
      const number = chapter - days.length + i + 1;
      return {
        url: `${home}/chapter-${number}`,
        label: i === days.length - 1 ? label : `Chapter ${number}`,
        readAt: at(d),
      };
    }),
  });

  const library = [
    novel({
      id: "n1",
      title: "The Lantern Archivist",
      site: "www.royalroad.com",
      home: "https://www.royalroad.com/fiction/44001/the-lantern-archivist",
      chapter: 212,
      label: "Chapter 212: Ash and Ledger",
      status: "active",
      tags: ["progression", "slow burn"],
      rating: 5,
      days: readingDays(11, {
        spanDays: 150,
        density: 0.3,
        recentDays: 12,
        perDay: 3,
      }),
    }),
    novel({
      id: "n2",
      title: "Tidewrought",
      site: "www.scribblehub.com",
      home: "https://www.scribblehub.com/series/88120/tidewrought",
      chapter: 97,
      label: "Chapter 97: The Salt Court",
      status: "active",
      tags: ["xianxia", "cultivation"],
      rating: 4,
      notes:
        "Picked back up after the tournament arc. The sect politics finally pay off.",
      days: readingDays(22, { spanDays: 120, density: 0.22, recentDays: 3 }),
    }),
    novel({
      id: "n3",
      title: "Grave of the Second Sun",
      site: "novelbin.com",
      home: "https://novelbin.com/b/grave-of-the-second-sun",
      chapter: 340,
      label: "Chapter 340: Interlude",
      status: "active",
      tags: ["cultivation", "long"],
      rating: 4,
      days: readingDays(33, { spanDays: 320, density: 0.24 }),
    }),
    novel({
      id: "n4",
      title: "A Quiet Apprenticeship",
      site: "creativenovels.com",
      home: "https://creativenovels.com/novel/a-quiet-apprenticeship",
      chapter: 58,
      label: "Chapter 58: Winter Terms",
      status: "paused",
      tags: ["cozy"],
      rating: 3,
      days: readingDays(44, { spanDays: 200, density: 0.08 }).filter(
        (d) => d > 21,
      ),
    }),
    novel({
      id: "n5",
      title: "Ninefold Cartography",
      site: "www.wuxiaworld.com",
      home: "https://www.wuxiaworld.com/novel/ninefold-cartography",
      chapter: 415,
      label: "Chapter 415: The Last Map",
      status: "completed",
      tags: ["finished"],
      rating: 5,
      days: readingDays(55, { spanDays: 340, density: 0.25, perDay: 3 }).filter(
        (d) => d > 30,
      ),
    }),
    novel({
      id: "n6",
      title: "Hollow Signal",
      site: "chikari.moe",
      home: "https://chikari.moe/series/hollow-signal",
      chapter: 24,
      label: "Chapter 24: Carrier Tone",
      status: "active",
      tags: ["sci-fi"],
      rating: 4,
      days: readingDays(66, { spanDays: 60, density: 0.3 }).filter(
        (d) => d > 7,
      ),
    }),
  ];
  // The book on the popup's chapter page leads the library: read an hour ago.
  const lead = library[0];
  lead.chapterHistory.at(-1).readAt = lead.updatedAt = at(1 / 24);
  return library;
}

// Original, abstract covers (no third-party art): a gradient, a motif, and the
// title set in the library's display face.
const COVERS = {
  n1: { from: "#3b2a1e", to: "#b45a2a", motif: "lantern" },
  n2: { from: "#12344a", to: "#3f8aa6", motif: "waves" },
  n3: { from: "#2a1a2e", to: "#c0793a", motif: "sun" },
  n4: { from: "#43533f", to: "#a8b58a", motif: "leaf" },
  n5: { from: "#2b2f45", to: "#8a7bb8", motif: "grid" },
  n6: { from: "#0f1d24", to: "#3e6f6a", motif: "rings" },
};

function coverSvg(id, title) {
  const { from, to, motif } = COVERS[id];
  const motifs = {
    lantern: `<rect x="150" y="120" width="60" height="90" rx="14" fill="none" stroke="#ffd9a8" stroke-width="6"/><circle cx="180" cy="165" r="18" fill="#ffd9a8" opacity=".85"/><line x1="180" y1="90" x2="180" y2="120" stroke="#ffd9a8" stroke-width="6"/>`,
    waves: [0, 1, 2, 3]
      .map(
        (i) =>
          `<path d="M0 ${140 + i * 34} q45 -26 90 0 t90 0 t90 0 t90 0" fill="none" stroke="#d6f1f7" stroke-opacity="${0.8 - i * 0.16}" stroke-width="6"/>`,
      )
      .join(""),
    sun: `<circle cx="180" cy="170" r="62" fill="#f6c27a" opacity=".9"/><circle cx="218" cy="150" r="54" fill="${from}"/>`,
    leaf: `<path d="M180 90 C250 140 240 230 180 260 C120 230 110 140 180 90 Z" fill="#eef3d9" opacity=".85"/><line x1="180" y1="100" x2="180" y2="258" stroke="${from}" stroke-width="5"/>`,
    grid: [0, 1, 2]
      .map((r) =>
        [0, 1, 2]
          .map(
            (c) =>
              `<rect x="${108 + c * 50}" y="${100 + r * 50}" width="40" height="40" rx="6" fill="#e7e1ff" opacity="${(r + c) % 2 ? 0.35 : 0.8}"/>`,
          )
          .join(""),
      )
      .join(""),
    rings: [0, 1, 2, 3]
      .map(
        (i) =>
          `<circle cx="180" cy="175" r="${22 + i * 24}" fill="none" stroke="#bfeee6" stroke-opacity="${0.9 - i * 0.2}" stroke-width="5"/>`,
      )
      .join(""),
  };
  const words = title.split(" ");
  const lines = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last && `${last} ${word}`.length <= 12)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const text = lines
    .map(
      (line, i) =>
        `<text x="180" y="${330 + i * 44}" text-anchor="middle">${line}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="500" viewBox="0 0 360 500">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="360" height="500" fill="url(#g)"/>
  ${motifs[motif]}
  <g fill="#fffaf2" font-family="'Iowan Old Style', Georgia, serif" font-size="38" font-weight="700">${text}</g>
  <rect x="24" y="24" width="312" height="452" fill="none" stroke="#fffaf2" stroke-opacity=".35" stroke-width="2"/>
</svg>`;
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
              : { ok: true },
          // What Safari reports, so iOS shows "Sign in with the app" and the
          // Mac shows the provider buttons.
          getPlatformInfo: async () => ({
            os: /iPhone|iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 ? "ios" : "mac"
          })
        }
      };
      addEventListener("load", async () => {
        const params = new URLSearchParams(location.search);
        for (let tries = 0; tries < 50 && !document.querySelector("#library .card"); tries += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const card = (id) => document.querySelector(\`#library .card[data-id="\${id}"]\`);
        // The top bar and filter bar stick, so land the target just below both.
        const reveal = (element) => {
          const filterBar = document.querySelector(".filter-bar");
          const below = filterBar.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING;
          const stuck = document.querySelector(".topbar").offsetHeight + (below ? filterBar.offsetHeight : 0);
          const top = element.getBoundingClientRect().top + scrollY;
          scrollTo({ top: Math.max(0, top - stuck - 20), behavior: "instant" });
        };
        const q = params.get("q");
        if (q) {
          const search = document.querySelector("#search");
          search.value = q;
          search.dispatchEvent(new Event("input", { bubbles: true }));
          // On a phone the results start below the fold; bring them up.
          if (innerWidth < 700) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            reveal(document.querySelector("#library"));
          }
        }
        const history = params.get("history");
        if (history) {
          const details = card(history)?.querySelector("details.history");
          if (details) {
            details.open = true;
            reveal(card(history));
          }
        }
        const edit = params.get("edit");
        if (edit && card(edit)) {
          // The class the Edit button sets, without focusing a field, so
          // no software keyboard covers the form.
          card(edit).classList.add("editing");
          reveal(card(edit));
        }
        const scroll = params.get("scroll");
        if (scroll) {
          const target = document.getElementById(scroll);
          if (target) reveal(target);
        }
        document.documentElement.dataset.captureReady = "true";
      });
    </script>
`;
  return optionsHtml.replace("</head>", stub + FOLLOW + "</head>");
}

// The simulator opens one Safari tab and each page follows the script from
// there: openurl would open a new tab per shot, and Safari's tab bar and
// lazily-loaded background tabs would then leak into the captures.
const FOLLOW = `    <script>
      setInterval(async () => {
        try {
          const next = await (await fetch("/__shot", { cache: "no-store" })).text();
          if (next && next !== location.pathname.slice(1) + location.search) location.replace("/" + next);
        } catch {}
      }, 400);
    </script>
`;

function seedPage(novels) {
  return `<!doctype html><meta charset="utf-8"><title>Seeding</title><script>
localStorage.setItem("novel-tracker:novels", ${JSON.stringify(JSON.stringify(novels))});
localStorage.removeItem("novel-tracker:sync-state");
location.replace("capture.html");
</script>`;
}

function popupHarness(popupHtml, novels) {
  const metadata = {
    title: "The Lantern Archivist",
    sourceSite: "www.royalroad.com",
    novelHomeUrl:
      "https://www.royalroad.com/fiction/44001/the-lantern-archivist",
    lastReadChapterUrl:
      "https://www.royalroad.com/fiction/44001/the-lantern-archivist/chapter-213",
    lastReadChapterLabel: "Chapter 213: A Door of Embers",
    coverImageUrl: `${ORIGIN}/covers/n1.svg`,
    status: "active",
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
            get: async () => ({ "novel-tracker:novels": ${JSON.stringify(novels)} }),
            set: async () => undefined
          }
        },
        runtime: {
          sendMessage: async () => ({ ok: true }),
          openOptionsPage: async () => undefined
        }
      };
      if (new URLSearchParams(location.search).has("continue")) {
        addEventListener("load", () => setTimeout(() => {
          const recent = document.querySelector("#continue-reading");
          if (recent) recent.open = true;
        }, 600));
      }
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
  <meta name="color-scheme" content="light dark">
  <title>The Lantern Archivist — Chapter 213</title>
${FOLLOW}
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      background: #f7f2ea;
      color: #2b2926;
      font-family: "Iowan Old Style", Georgia, "Times New Roman", serif;
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
    /* iPad and Mac: a popover hanging from the toolbar button, top right. */
    .extension-popup {
      position: fixed;
      z-index: 2;
      top: 22px;
      right: 26px;
      width: 394px;
      overflow: hidden;
      border-radius: 18px;
      background: #f6f3ee;
      box-shadow: 0 26px 80px rgba(29, 21, 15, .35);
    }
    .extension-popup iframe { display: block; width: 100%; height: 600px; border: 0; }
    .grabber { display: none; }
    @media (prefers-color-scheme: dark) {
      body { background: #1b1916; color: #e6ded3; }
      h2 { color: #a39686; }
      .eyebrow { color: #e0925f; }
      .scrim { background: rgba(0, 0, 0, .4); }
      .extension-popup { background: #121417; box-shadow: 0 26px 80px rgba(0, 0, 0, .6); }
      .grabber { background: rgba(255, 255, 255, .28); }
    }
    /* iPhone: Safari presents the popup as a sheet rising from the bottom
       toolbar. The padding keeps its content clear of the floating toolbar. */
    @media (max-width: 600px) {
      article { width: calc(100% - 36px); padding-top: 42px; }
      .extension-popup {
        top: auto;
        right: 0;
        bottom: 0;
        left: 0;
        width: auto;
        padding-bottom: 92px;
        border-radius: 26px 26px 0 0;
        box-shadow: 0 -12px 50px rgba(29, 21, 15, .28);
      }
      .grabber {
        display: block;
        width: 38px;
        height: 5px;
        margin: 7px auto 3px;
        border-radius: 3px;
        background: rgba(0, 0, 0, .2);
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
    <p>She counted the entries twice. Every page she had ever read was there, in her own hand, down to the one she had abandoned on the night the tide came in.</p>
  </article>
  <div class="scrim" aria-hidden="true"></div>
  <div class="extension-popup">
    <div class="grabber" aria-hidden="true"></div>
    <iframe title="Novel Tracker extension popup"></iframe>
  </div>
  <script>
    // Safari sizes an extension popover or sheet to its content; do the same here.
    const frame = document.querySelector(".extension-popup iframe");
    frame.src = "popup-frame.html" + location.search;
    frame.addEventListener("load", () => {
      const fit = () => {
        const height = frame.contentDocument.body.scrollHeight;
        frame.style.height = Math.min(height, innerHeight - 140) + "px";
      };
      new ResizeObserver(fit).observe(frame.contentDocument.body);
      fit();
    });
  </script>
</body>
</html>`;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

async function startServer(extra, state) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, ORIGIN);
    const name = url.pathname.replace(/^\//, "") || "index.html";
    if (name === "__shot") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "cache-control": "no-store",
      });
      return response.end(state.current);
    }
    if (extra[name]) {
      response.writeHead(200, {
        "content-type": MIME[path.extname(name)] || MIME[".html"],
      });
      return response.end(extra[name]);
    }
    const file = path.join(distDir, name);
    if (!file.startsWith(distDir) || !existsSync(file)) {
      response.writeHead(404);
      return response.end("not found");
    }
    response.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
    });
    response.end(await readFile(file));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
  return server;
}

// Safari may wait for our HTTP server before openurl returns. Keep Node's
// event loop free to serve that request while simulator commands are running.
async function simctl(args) {
  const { stdout } = await run("xcrun", ["simctl", ...args], {
    encoding: "utf8",
    timeout: 180_000,
  });
  return stdout;
}

// Always start from a freshly created device: a leftover one keeps Safari tabs,
// seeded storage from an older library, and possibly an unfinished
// ASWebAuthenticationSession whose prompt would sit above Safari in every shot.
async function ensureDevice(device) {
  if ((await simctl(["list", "devices"])).includes(device.name))
    await deleteDevice(device);
  await simctl(["create", device.name, device.deviceType]);
  console.log(`Booting ${device.name} and waiting for it to be ready...`);
  await simctl(["boot", device.name]);
  await simctl(["bootstatus", device.name, "-b"]);
  // A fresh iPhone's Safari shows a "View Bookmarks, Share Menu, and Open
  // Tabs" tip over the toolbar until it is tapped away. TipKit honours this
  // default, the same switch as its -com.apple.TipKit.HideAllTips argument.
  await simctl([
    "spawn",
    device.name,
    "defaults",
    "write",
    "-g",
    "com.apple.TipKit.HideAllTips",
    "-bool",
    "YES",
  ]);
  // Apple's own screenshots show 9:41 with full signal and battery.
  await simctl([
    "status_bar",
    device.name,
    "override",
    "--time",
    "9:41",
    "--dataNetwork",
    "wifi",
    "--wifiMode",
    "active",
    "--wifiBars",
    "3",
    "--cellularMode",
    "active",
    "--cellularBars",
    "4",
    "--batteryState",
    "charged",
    "--batteryLevel",
    "100",
  ]);
  await simctl(["ui", device.name, "appearance", "light"]);
}

function shotFile(device, index, shot) {
  return path.join(
    outDir,
    device.folder,
    `${String(index).padStart(2, "0")}-${shot.name}.jpg`,
  );
}

async function deleteDevice(device) {
  if ((await simctl(["list", "devices", "booted"])).includes(device.name)) {
    await simctl(["shutdown", device.name]);
  }
  await simctl(["delete", device.name]);
}

async function assertSize(device, file) {
  const meta = await sharp(file).metadata();
  if (`${meta.width}x${meta.height}` !== device.size) {
    throw new Error(
      `${device.key} produced ${meta.width}x${meta.height}, expected ${device.size}. App Store slots require exact dimensions.`,
    );
  }
}

async function captureSimulator(device, shots, appPath, state) {
  await ensureDevice(device);
  let index = 0;
  let tabOpen = false;

  for (const shot of shots) {
    if (shot.app && !appPath) {
      console.warn(
        `Skipping the app screenshot for ${device.name}: set NOVEL_TRACKER_APP_PATH to a simulator build of Novel Tracker.app.`,
      );
      continue;
    }
    index += 1;
    const target = shotFile(device, index, shot);
    const raw = `${target}.png`;
    if (shot.manual?.includes(device.key)) {
      console.log(
        `${path.relative(rootDir, target)}  kept: captured by hand (${shot.name})`,
      );
      continue;
    }

    console.log(`Capturing ${device.key}: ${shot.name}...`);
    await simctl([
      "ui",
      device.name,
      "appearance",
      shot.dark ? "dark" : "light",
    ]);
    if (shot.app) {
      await simctl(["install", device.name, appPath]);
      // Launched over Safari, the status bar would show a "◀ Safari" back link.
      await simctl(["terminate", device.name, "com.apple.mobilesafari"]).catch(
        () => {},
      );
      await simctl(["launch", device.name, BUNDLE_ID]);
    } else {
      state.current = shot.path;
      if (!tabOpen) {
        // The seed page stores the library, then hands off to the shot.
        await simctl(["openurl", device.name, `${ORIGIN}/seed.html`]);
        tabOpen = true;
      }
    }
    // A freshly-created simulator can display Safari onboarding cards and
    // transient system tips while the first URL is still loading. Give the
    // first capture enough time for those to settle and the seeded library to
    // render; later shots only navigate the open tab.
    const settleTime = index === 1 ? 20_000 : 6_000;
    await new Promise((resolve) => setTimeout(resolve, settleTime));

    await simctl(["io", device.name, "screenshot", raw]);
    await assertSize(device, raw);
    await sharp(raw)
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
      .toFile(target);
    await run("rm", ["-f", raw]);
    console.log(
      `${path.relative(rootDir, target)}  ${device.size}  (${shot.name})`,
    );
  }

  if (!keepDevices) await deleteDevice(device);
}

// The Mac app is a Safari extension, so its screenshots are the same pages at
// a desktop window size. Headless Chromium renders them from the shipping
// files with the same system fonts Safari uses.
async function captureBrowser(device, shots, state) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    let index = 0;
    for (const shot of shots) {
      index += 1;
      const target = shotFile(device, index, shot);
      console.log(`Capturing ${device.key}: ${shot.name}...`);
      const context = await browser.newContext({
        viewport: device.viewport,
        deviceScaleFactor: 2,
        colorScheme: shot.dark ? "dark" : "light",
      });
      const page = await context.newPage();
      // Every context starts with empty storage, so seed it first.
      state.current = shot.path;
      await page.goto(`${ORIGIN}/seed.html`);
      await page.waitForURL(`${ORIGIN}/${shot.path}`);
      if (shot.path.startsWith("chapter.html")) {
        await page
          .frameLocator("iframe")
          .locator("#save-button:not([disabled])")
          .waitFor();
      } else {
        await page.waitForSelector("html[data-capture-ready]");
      }
      // The follow script polls, so the network never idles; wait for covers
      // (lazy ones in a closed list never load, so they are skipped).
      for (const frame of page.frames()) {
        await frame.waitForFunction(() =>
          [...document.images].every(
            (image) => image.complete || image.loading === "lazy",
          ),
        );
      }
      await page.waitForTimeout(800);
      const png = await page.screenshot({ type: "png" });
      await context.close();
      const image = sharp(png);
      const meta = await image.metadata();
      if (`${meta.width}x${meta.height}` !== device.size) {
        throw new Error(
          `${device.key} produced ${meta.width}x${meta.height}, expected ${device.size}.`,
        );
      }
      await image
        .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
        .toFile(target);
      console.log(
        `${path.relative(rootDir, target)}  ${device.size}  (${shot.name})`,
      );
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!existsSync(path.join(distDir, "options.html"))) {
    throw new Error(
      "dist/ is missing. Run `npm run build` first (a production build, not --env=local).",
    );
  }

  const appPath = process.env.NOVEL_TRACKER_APP_PATH;
  if (appPath && !existsSync(appPath))
    throw new Error(`NOVEL_TRACKER_APP_PATH does not exist: ${appPath}`);

  const novels = demoLibrary();
  const optionsHtml = await readFile(
    path.join(distDir, "options.html"),
    "utf8",
  );
  const popupHtml = await readFile(path.join(distDir, "popup.html"), "utf8");
  const covers = Object.fromEntries(
    novels.map((novel) => [
      `covers/${novel.id}.svg`,
      coverSvg(novel.id, novel.title),
    ]),
  );
  const state = { current: "capture.html" };
  const server = await startServer(
    {
      "capture.html": captureHarness(optionsHtml),
      "seed.html": seedPage(novels),
      "chapter.html": chapterPage(),
      "popup-frame.html": popupHarness(popupHtml, novels),
      ...covers,
    },
    state,
  );

  if (serveOnly) {
    console.log(
      `Serving the capture harness at ${ORIGIN}/seed.html (Ctrl-C to stop)`,
    );
    return;
  }

  try {
    for (const device of devicesToCapture) {
      await mkdir(path.join(outDir, device.folder), { recursive: true });
      const shots = SHOTS.filter(
        (shot) => !shot.only || shot.only.includes(device.key),
      );
      if (device.browser) await captureBrowser(device, shots, state);
      else await captureSimulator(device, shots, appPath, state);
    }
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
