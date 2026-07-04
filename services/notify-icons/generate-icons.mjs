#!/usr/bin/env node
// Generates the notification icon set with zero deps:
//  - per-kind 256px PNGs (dark terminal tile, traffic dots, ">_" tinted per kind)
//  - the OpenClaw app icon (terminal tile + orange claw badge bottom-right) at
//    128/256/512 px, wrapped into openclaw.icns for the branded notifier app
//    bundle (build-notifier-app.sh) — that icns is what macOS shows on the LEFT
//    of the banner.
// Re-run after changing KINDS/geometry: node services/notify-icons/generate-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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
const CLAW = hex('#FF8A3D');
const CLAW_SLASH = hex('#FFF4EA');

function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// ── tiny signed-distance rasterizer ──────────────────────────────────────────

function blend(px, i, [r, g, b], a) {
  if (a <= 0) return;
  const inv = 1 - a;
  px[i]     = r * a + px[i] * inv;
  px[i + 1] = g * a + px[i + 1] * inv;
  px[i + 2] = b * a + px[i + 2] * inv;
  px[i + 3] = Math.min(255, 255 * a + px[i + 3] * inv);
}

function paint(px, size, color, sdf) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      const a = Math.max(0, Math.min(1, 0.5 - d));
      blend(px, (y * size + x) * 4, color, a);
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

function encodePNG(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ICNS wrapping (modern PNG-embedded entries) ───────────────────────────────

const ICNS_TYPES = { 128: 'ic07', 256: 'ic08', 512: 'ic09' };

function encodeICNS(entries) {
  const parts = entries.map(({ size, png }) => {
    const head = Buffer.alloc(8);
    head.write(ICNS_TYPES[size], 0, 'ascii');
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const total = 8 + parts.reduce((n, p) => n + p.length, 0);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...parts]);
}

// ── the icons (all geometry in 256-space, scaled by s) ───────────────────────

function drawTile(px, size, accent) {
  const s = size / 256;
  paint(px, size, accent, sdRoundRect(128 * s, 128 * s, 120 * s, 120 * s, 52 * s));
  paint(px, size, BG, sdRoundRect(128 * s, 128 * s, 110 * s, 110 * s, 44 * s));
  for (const cx of [64, 94, 124]) paint(px, size, DOT, sdCircle(cx * s, 62 * s, 9 * s));
  paint(px, size, accent, sdSegment(70 * s, 110 * s, 116 * s, 146 * s, 20 * s));
  paint(px, size, accent, sdSegment(116 * s, 146 * s, 70 * s, 182 * s, 20 * s));
  paint(px, size, accent, sdRoundRect(163 * s, 178 * s, 33 * s, 9 * s, 8 * s));
}

// Bottom-right claw badge: filled orange disc with three diagonal claw slashes.
function drawClawBadge(px, size) {
  const s = size / 256;
  const cx = 194 * s, cy = 194 * s, r = 58 * s;
  paint(px, size, BG, sdCircle(cx, cy, r + 8 * s));
  paint(px, size, CLAW, sdCircle(cx, cy, r));
  for (const off of [-26, 0, 26]) {
    paint(px, size, CLAW_SLASH, sdSegment(
      cx + (off - 16) * s, cy - 28 * s,
      cx + (off + 16) * s, cy + 28 * s,
      11 * s,
    ));
  }
}

function kindIcon(accent, size = 256) {
  const px = new Uint8ClampedArray(size * size * 4);
  drawTile(px, size, accent);
  return encodePNG(px, size);
}

function appIcon(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  drawTile(px, size, hex(KINDS.default));
  drawClawBadge(px, size);
  return encodePNG(px, size);
}

const outDir = path.dirname(new URL(import.meta.url).pathname);
for (const [kind, color] of Object.entries(KINDS)) {
  const file = path.join(outDir, `${kind}.png`);
  fs.writeFileSync(file, kindIcon(hex(color)));
  console.log(`wrote ${file}`);
}

const appSizes = [128, 256, 512].map((size) => ({ size, png: appIcon(size) }));
fs.writeFileSync(path.join(outDir, 'app.png'), appSizes[1].png);
fs.writeFileSync(path.join(outDir, 'openclaw.icns'), encodeICNS(appSizes));
console.log(`wrote ${path.join(outDir, 'app.png')}`);
console.log(`wrote ${path.join(outDir, 'openclaw.icns')}`);
