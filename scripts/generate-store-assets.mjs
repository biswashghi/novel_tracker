import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "store-assets");
const tempDir = path.join(outDir, ".tmp");

const colors = {
  bg: "#f6f1e8",
  surface: "#fffaf2",
  paper: "#ffffff",
  border: "#d9c9a8",
  text: "#2d2418",
  muted: "#6b5b46",
  accent: "#9f5d2f",
  accentDark: "#7f4218",
  accentSoft: "#ecd6bf",
  danger: "#b14132",
  blue: "#315d7d",
  gold: "#d8a75d"
};

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;"
    };
    return map[char];
  });
}

function text(value, x, y, size, fill = colors.text, weight = 600, attrs = "") {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="${weight}" ${attrs}>${esc(value)}</text>`;
}

function rect(x, y, width, height, fill, radius = 0, stroke = "", strokeWidth = 1) {
  const strokeAttrs = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : "";
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"${strokeAttrs}/>`;
}

function button(label, x, y, width, fill = colors.accent, textFill = "#fffaf4") {
  return [
    rect(x, y, width, 38, fill, 19),
    text(label, x + 18, y + 25, 15, textFill, 700)
  ].join("");
}

function pill(label, x, y, width, fill = colors.accentSoft) {
  return [
    rect(x, y, width, 32, fill, 16),
    text(label, x + 16, y + 22, 15, colors.text, 700)
  ].join("");
}

function cover(x, y, width, height, title, hue = colors.blue) {
  return `
    <defs>
      <linearGradient id="cover-${x}-${y}" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="${hue}"/>
        <stop offset="1" stop-color="${colors.accentDark}"/>
      </linearGradient>
    </defs>
    ${rect(x, y, width, height, `url(#cover-${x}-${y})`, 14)}
    <circle cx="${x + width - 26}" cy="${y + 26}" r="20" fill="rgba(255,250,242,0.2)"/>
    <path d="M ${x + 16} ${y + height - 28} C ${x + 46} ${y + height - 72}, ${x + 76} ${y + height - 56}, ${x + width - 12} ${y + height - 88}" stroke="rgba(255,250,242,0.5)" stroke-width="5" fill="none"/>
    ${text(title, x + 14, y + height - 22, 18, "#fffaf4", 800)}
  `;
}

function baseSvg(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${colors.bg}"/>
    <circle cx="${width - 150}" cy="70" r="${Math.max(width, height) * 0.28}" fill="#ead3b2" opacity="0.45"/>
    <circle cx="70" cy="${height - 40}" r="${Math.max(width, height) * 0.24}" fill="#d7a86a" opacity="0.17"/>
    ${body}
  </svg>`;
}

function libraryScreenshot() {
  const cards = [
    ["Elydes", "royalroad.com", "Chapter 384 - The Line", "Updated today", "EL", colors.blue],
    ["The Fractured Light", "creativenovels.com", "Chapter 12 - Ember Gate", "Updated yesterday", "FL", colors.accent],
    ["Scarlet Steel", "scribblehub.com", "Chapter 2470326", "Updated this week", "SS", "#9b3f48"]
  ];

  const cardMarkup = cards.map((item, index) => {
    const y = 336 + index * 132;
    return `
      ${rect(70, y, 1140, 118, "rgba(255,250,242,0.96)", 18, colors.border)}
      ${cover(92, y + 16, 54, 72, item[4], item[5])}
      ${text(item[0], 166, y + 38, 25, colors.text, 800)}
      ${text(`${item[1]} • active • ${item[3]}`, 166, y + 64, 17, colors.muted, 500)}
      ${pill(item[2], 900, y + 22, 286)}
      ${button("Open chapter", 166, y + 72, 132)}
      ${button("Edit", 314, y + 72, 70, colors.accentSoft, colors.text)}
    `;
  }).join("");

  return baseSvg(1280, 800, `
    ${rect(50, 46, 1180, 230, "rgba(255,250,242,0.94)", 24, colors.border)}
    ${text("Reading archive", 86, 96, 18, colors.accentDark, 800)}
    ${text("Keep every chapter trail in one place.", 86, 150, 45, colors.text, 800)}
    ${text("Track active novels, reopen where you stopped,", 86, 194, 22, colors.muted, 500)}
    ${text("and keep a clean history as chapter URLs move forward.", 86, 224, 22, colors.muted, 500)}
    ${pill("3 tracked", 1010, 72, 104)}
    ${pill("3 active", 1130, 72, 86)}
    ${rect(50, 296, 1180, 54, "rgba(255,250,242,0.94)", 18, colors.border)}
    ${text("Search by title or site", 82, 331, 18, colors.muted, 500)}
    ${text("All statuses", 640, 331, 18, colors.text, 600)}
    ${text("Recently updated", 890, 331, 18, colors.text, 600)}
    ${cardMarkup}
  `);
}

function popupScreenshot() {
  return baseSvg(1280, 800, `
    ${rect(70, 70, 660, 660, "rgba(255,250,242,0.96)", 28, colors.border)}
    ${text("Novel Tracker", 110, 126, 40, colors.text, 800)}
    ${text("Save the chapter you are on now, then jump back later from your library.", 110, 166, 22, colors.muted, 500)}
    ${rect(110, 210, 540, 72, colors.paper, 16, colors.border)}
    ${text("Novel title", 130, 236, 17, colors.muted, 700)}
    ${text("Elydes", 130, 266, 24, colors.text, 700)}
    ${rect(110, 306, 540, 72, colors.paper, 16, colors.border)}
    ${text("Current chapter", 130, 332, 17, colors.muted, 700)}
    ${text("Chapter 384 - The Line", 130, 362, 24, colors.text, 700)}
    ${rect(110, 402, 540, 72, colors.paper, 16, colors.border)}
    ${text("Current page URL", 130, 428, 17, colors.muted, 700)}
    ${text("royalroad.com/fiction/.../chapter-384-the-line", 130, 458, 20, colors.text, 500)}
    ${rect(110, 498, 540, 72, colors.paper, 16, colors.border)}
    ${text("Reading status", 130, 524, 17, colors.muted, 700)}
    ${text("Active", 130, 554, 24, colors.text, 700)}
    ${button("Save progress", 110, 614, 150)}
    ${button("Open library", 280, 614, 142, colors.accentSoft, colors.text)}
    ${rect(785, 170, 390, 460, "rgba(255,250,242,0.85)", 28, colors.border)}
    ${cover(835, 228, 110, 148, "EL", colors.blue)}
    ${text("One click tracking", 835, 430, 34, colors.text, 800)}
    ${text("Read the active tab, save clean", 835, 474, 21, colors.muted, 500)}
    ${text("metadata, and keep it local.", 835, 504, 21, colors.muted, 500)}
    ${pill("Local-first", 835, 535, 112)}
    ${pill("No account", 960, 535, 108)}
  `);
}

function historyScreenshot() {
  return baseSvg(1280, 800, `
    ${rect(60, 58, 1160, 684, "rgba(255,250,242,0.96)", 28, colors.border)}
    ${text("Chapter history", 100, 128, 48, colors.text, 800)}
    ${text("Each novel keeps a hidden trail of chapters.", 100, 172, 23, colors.muted, 500)}
    ${text("Recover quickly if you jump back or revisit older pages.", 100, 202, 23, colors.muted, 500)}
    ${cover(100, 236, 116, 154, "AA", "#415f88")}
    ${text("Aura Overload", 250, 266, 34, colors.text, 800)}
    ${text("royalroad.com • active • Updated today", 250, 300, 19, colors.muted, 500)}
    ${pill("26. Sunday Roast", 950, 238, 200)}
    ${button("Open chapter", 250, 338, 140)}
    ${button("Edit", 410, 338, 70, colors.accentSoft, colors.text)}
    ${rect(250, 425, 860, 1, colors.border)}
    ${text("History (4)", 250, 470, 30, colors.text, 800)}
    ${["26. Sunday Roast", "25. Knock Twice", "24. The Long Hall", "23. Static Bloom"].map((label, index) => {
      const y = 514 + index * 48;
      return `
        ${rect(250, y - 26, 860, 38, index === 0 ? "#f3dfc5" : "#fff7ed", 12, colors.border, 0.7)}
        ${text(label, 270, y, 20, colors.text, 700)}
        ${text(index === 0 ? "latest" : `${index + 1} days ago`, 970, y, 17, colors.muted, 500)}
      `;
    }).join("")}
  `);
}

function smallPromo() {
  return baseSvg(440, 280, `
    ${rect(24, 24, 392, 232, "rgba(255,250,242,0.96)", 22, colors.border)}
    ${cover(48, 72, 70, 94, "NT", colors.blue)}
    ${text("Novel Tracker", 140, 88, 31, colors.text, 800)}
    ${text("Never lose your chapter.", 140, 124, 20, colors.muted, 600)}
    ${pill("Local-first", 140, 152, 110)}
    ${pill("Chapter history", 260, 152, 132)}
    ${button("Reopen last chapter", 140, 202, 188)}
  `);
}

function marqueePromo() {
  return baseSvg(1400, 560, `
    ${rect(60, 54, 1280, 452, "rgba(255,250,242,0.96)", 34, colors.border)}
    ${text("Novel Tracker", 112, 142, 70, colors.text, 800)}
    ${text("Track chapters in one local-first library.", 112, 202, 31, colors.muted, 500)}
    ${pill("Royal Road", 112, 258, 126)}
    ${pill("Patreon", 254, 258, 104)}
    ${pill("Wuxiaworld", 374, 258, 130)}
    ${pill("ScribbleHub", 520, 258, 142)}
    ${button("Reopen exactly where you stopped", 112, 338, 292)}
    ${rect(770, 118, 470, 292, colors.paper, 28, colors.border)}
    ${cover(812, 166, 96, 128, "EL", colors.blue)}
    ${text("Elydes", 936, 188, 34, colors.text, 800)}
    ${text("Chapter 384 - The Line", 936, 226, 22, colors.muted, 600)}
    ${rect(936, 252, 234, 28, colors.accentSoft, 14)}
    ${text("History saved automatically", 954, 272, 17, colors.text, 700)}
    ${rect(812, 334, 360, 1, colors.border)}
    ${text("3 tracked • 3 active • JSON backup", 812, 372, 22, colors.muted, 600)}
  `);
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function renderAsset(name, width, height, svg) {
  const svgPath = path.join(tempDir, `${name}.svg`);
  const pngPath = path.join(tempDir, `${name}.png`);
  const jpgPath = path.join(outDir, `${name}.jpg`);

  await writeFile(svgPath, svg, "utf8");
  await run("sips", ["-s", "format", "png", svgPath, "--out", pngPath]);
  await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "95", pngPath, "--out", jpgPath]);

  const bytes = await readFile(jpgPath);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`${jpgPath} was not created as a JPEG`);
  }

  console.log(`Created ${jpgPath} (${width}x${height})`);
}

await mkdir(tempDir, { recursive: true });
await renderAsset("screenshot-library-1280x800", 1280, 800, libraryScreenshot());
await renderAsset("screenshot-popup-1280x800", 1280, 800, popupScreenshot());
await renderAsset("screenshot-history-1280x800", 1280, 800, historyScreenshot());
await renderAsset("small-promo-tile-440x280", 440, 280, smallPromo());
await renderAsset("marquee-promo-tile-1400x560", 1400, 560, marqueePromo());
await rm(tempDir, { recursive: true, force: true });
