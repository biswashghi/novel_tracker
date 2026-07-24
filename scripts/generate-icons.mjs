import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "src", "icons");

const palette = {
  bgOuter: [247, 238, 224, 255],
  bgInner: [233, 212, 182, 255],
  ink: [53, 38, 25, 255],
  cover: [129, 72, 38, 255],
  coverDark: [94, 48, 24, 255],
  paper: [255, 249, 239, 255],
  ribbon: [182, 70, 54, 255],
  glow: [255, 255, 255, 255]
};

const SIZES = [16, 32, 48, 128];

function createCanvas(size) {
  return {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4)
  };
}

function setPixel(canvas, x, y, rgba) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    return;
  }

  const index = (y * canvas.width + x) * 4;
  const alpha = rgba[3] / 255;
  const inv = 1 - alpha;

  canvas.data[index] = Math.round(rgba[0] * alpha + canvas.data[index] * inv);
  canvas.data[index + 1] = Math.round(rgba[1] * alpha + canvas.data[index + 1] * inv);
  canvas.data[index + 2] = Math.round(rgba[2] * alpha + canvas.data[index + 2] * inv);
  canvas.data[index + 3] = 255;
}

function fillRect(canvas, x, y, width, height, rgba) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      setPixel(canvas, px, py, rgba);
    }
  }
}

function fillRoundedRect(canvas, x, y, width, height, radius, rgba) {
  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const dx = px < x + r ? x + r - px : px >= x + width - r ? px - (x + width - r - 1) : 0;
      const dy = py < y + r ? y + r - py : py >= y + height - r ? py - (y + height - r - 1) : 0;
      if (dx * dx + dy * dy <= r * r) {
        setPixel(canvas, px, py, rgba);
      }
    }
  }
}

function fillCircle(canvas, cx, cy, radius, rgba) {
  for (let py = Math.floor(cy - radius); py <= Math.ceil(cy + radius); py += 1) {
    for (let px = Math.floor(cx - radius); px <= Math.ceil(cx + radius); px += 1) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(canvas, px, py, rgba);
      }
    }
  }
}

function fillVerticalGradient(canvas, topColor, bottomColor) {
  for (let y = 0; y < canvas.height; y += 1) {
    const t = y / Math.max(1, canvas.height - 1);
    const rgba = [
      Math.round(topColor[0] * (1 - t) + bottomColor[0] * t),
      Math.round(topColor[1] * (1 - t) + bottomColor[1] * t),
      Math.round(topColor[2] * (1 - t) + bottomColor[2] * t),
      255
    ];
    fillRect(canvas, 0, y, canvas.width, 1, rgba);
  }
}

function drawIcon(canvas) {
  const size = canvas.width;
  fillVerticalGradient(canvas, palette.bgOuter, palette.bgInner);

  fillCircle(canvas, size * 0.22, size * 0.18, size * 0.2, [255, 255, 255, 58]);
  fillCircle(canvas, size * 0.78, size * 0.82, size * 0.24, [255, 255, 255, 34]);

  const margin = Math.round(size * 0.14);
  const panelRadius = Math.max(2, Math.round(size * 0.18));
  fillRoundedRect(
    canvas,
    margin,
    margin,
    size - margin * 2,
    size - margin * 2,
    panelRadius,
    palette.cover
  );
  fillRoundedRect(
    canvas,
    margin + 1,
    margin + 1,
    size - margin * 2 - 2,
    size - margin * 2 - 2,
    panelRadius - 1,
    palette.coverDark
  );

  const pageX = Math.round(size * 0.34);
  const pageY = Math.round(size * 0.23);
  const pageW = Math.round(size * 0.31);
  const pageH = Math.round(size * 0.52);
  fillRoundedRect(canvas, pageX, pageY, pageW, pageH, Math.max(2, Math.round(size * 0.05)), palette.paper);
  fillRect(canvas, pageX + Math.max(1, Math.round(size * 0.035)), pageY, Math.max(1, Math.round(size * 0.02)), pageH, [235, 220, 195, 255]);

  const lineInset = Math.max(2, Math.round(size * 0.06));
  const lineX = pageX + lineInset;
  const lineW = pageW - lineInset * 1.6;
  const lineH = Math.max(1, Math.round(size * 0.025));
  const lines = [0.19, 0.34, 0.49];
  for (const offset of lines) {
    fillRoundedRect(
      canvas,
      lineX,
      pageY + Math.round(pageH * offset),
      Math.max(2, Math.round(lineW)),
      lineH,
      lineH,
      [191, 163, 129, 255]
    );
  }

  const ribbonW = Math.max(2, Math.round(size * 0.08));
  const ribbonX = pageX + pageW - ribbonW - Math.max(1, Math.round(size * 0.045));
  const ribbonY = pageY - Math.max(1, Math.round(size * 0.02));
  const ribbonH = Math.round(size * 0.44);
  fillRect(canvas, ribbonX, ribbonY, ribbonW, ribbonH, palette.ribbon);

  const notchY = ribbonY + ribbonH;
  for (let row = 0; row < Math.round(size * 0.08); row += 1) {
    const inset = row;
    fillRect(canvas, ribbonX + inset, notchY + row, ribbonW - inset * 2, 1, palette.ribbon);
  }

  fillCircle(canvas, size * 0.73, size * 0.29, Math.max(1.2, size * 0.035), [255, 240, 215, 240]);
  fillRect(canvas, Math.round(size * 0.72), Math.round(size * 0.22), 1, Math.max(1, Math.round(size * 0.05)), [255, 240, 215, 220]);
  fillRect(canvas, Math.round(size * 0.68), Math.round(size * 0.28), Math.max(1, Math.round(size * 0.05)), 1, [255, 240, 215, 220]);
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(canvas) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = canvas.width * 4;
  const raw = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      raw[y * (stride + 1) + 1 + x] = canvas.data[rowStart + x];
    }
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

await mkdir(outDir, { recursive: true });

for (const size of SIZES) {
  const canvas = createCanvas(size);
  drawIcon(canvas);
  const png = encodePng(canvas);
  await writeFile(path.join(outDir, `icon-${size}.png`), png);
}

console.log(`Generated icons in ${outDir}`);
