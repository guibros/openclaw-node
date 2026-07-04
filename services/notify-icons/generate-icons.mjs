#!/usr/bin/env node
// Generates the per-kind notification icon set (256x256 PNGs) with zero deps:
// a dark terminal tile with traffic-light dots and a ">_" prompt tinted per kind.
// Re-run after changing KINDS/geometry: node services/notify-icons/generate-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 256;

const KINDS = {
  default: '#8B949E',
  info:    '#4A9EFF',
  success: '#3FB950',
  warn:    '#D29922',
  error:   '#F85149',
  block:   '#BC58F5',
};

const BG = hex('#1B1E28');
const DOT = hex('#555C6E');

function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// ── tiny signed-distance rasterizer ──────────────────────────────────────────

function makeCanvas() {
  return new Uint8ClampedArray(SIZE * SIZE * 4);
}

function blend(px, i, [r, g, b], a) {
  if (a <= 0) return;
  const inv = 1 - a;
  px[i]     = r * a + px[i] * inv;
  px[i + 1] = g * a + px[i + 1] * inv;
  px[i + 2] = b * a + px[i + 2] * inv;
  px[i + 3] = Math.min(255, 255 * a + px[i + 3] * inv);
}

function paint(px, color, sdf) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      const a = Math.max(0, Math.min(1, 0.5 - d));
      blend(px, (y * SIZE + x) * 4, color, a);
    }
  }
}

const sdRoundRect = (cx, cy, hw, hh, r) => (x, y) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

const sdCircle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

const sdSegment = (x1, y1, x2, y2, th) => (x, y) => {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) - th / 2;
};

// ── PNG encoding (RGBA, 8-bit) ───────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── the icon ─────────────────────────────────────────────────────────────────

function drawIcon(accent) {
  const px = makeCanvas();
  paint(px, accent, sdRoundRect(128, 128, 120, 120, 52));            // accent frame
  paint(px, BG, sdRoundRect(128, 128, 110, 110, 44));                // terminal body
  for (const cx of [64, 94, 124]) paint(px, DOT, sdCircle(cx, 62, 9));
  paint(px, accent, sdSegment(70, 110, 116, 146, 20));               // ">"
  paint(px, accent, sdSegment(116, 146, 70, 182, 20));
  paint(px, accent, sdRoundRect(163, 178, 33, 9, 8));                // "_"
  return px;
}

const outDir = path.dirname(new URL(import.meta.url).pathname);
for (const [kind, color] of Object.entries(KINDS)) {
  const file = path.join(outDir, `${kind}.png`);
  fs.writeFileSync(file, encodePNG(drawIcon(hex(color))));
  console.log(`wrote ${file}`);
}
