'use strict';

/**
 * 生成应用图标 build/icon.png（512x512）。
 * 纯 Node 实现（zlib 内置），无需任何图像库。
 * 设计：深色渐变圆角方块 + 蓝色 ">" 提示符 + 白色 "_" 光标。
 * 重新生成：npm run icon
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const px = new Uint8Array(SIZE * SIZE * 4);

// ---------- 像素操作（source-over 混合） ----------
function setPx(x, y, r, g, b, a) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const sa = a / 255;
  if (sa <= 0) return;
  const da = px[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / outA);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / outA);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

// ---------- 几何 ----------
function insideRoundedRect(x, y, r) {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const min = r;
  const max = SIZE - r;
  const qx = Math.max(min, Math.min(cx, max));
  const qy = Math.max(min, Math.min(cy, max));
  const dx = cx - qx;
  const dy = cy - qy;
  return dx * dx + dy * dy <= r * r;
}

function distToSeg(px0, py0, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, ((px0 - x0) * dx + (py0 - y0) * dy) / len2));
  const cx = x0 + t * dx;
  const cy = y0 + t * dy;
  const ex = px0 - cx;
  const ey = py0 - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

function drawLine(x0, y0, x1, y1, w, r, g, b) {
  const half = w / 2;
  const minX = Math.floor(Math.min(x0, x1) - half) - 2;
  const maxX = Math.ceil(Math.max(x0, x1) + half) + 2;
  const minY = Math.floor(Math.min(y0, y1) - half) - 2;
  const maxY = Math.ceil(Math.max(y0, y1) + half) + 2;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = distToSeg(x + 0.5, y + 0.5, x0, y0, x1, y1);
      const cov = Math.min(1, half - d + 0.5);
      if (cov <= 0) continue;
      setPx(x, y, r, g, b, Math.round(cov * 255));
    }
  }
}

// ---------- 绘制 ----------
// 背景：圆角方块，垂直渐变
const R = 96;
const top = [46, 58, 89];
const bottom = [22, 26, 35];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (!insideRoundedRect(x, y, R)) continue;
    const t = y / (SIZE - 1);
    const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
    const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
    const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
    setPx(x, y, r, g, b, 255);
  }
}

const BLUE = [76, 141, 255];
const WHITE = [245, 247, 250];

// ">" 提示符（蓝色，指向右）
drawLine(140, 150, 260, 256, 54, ...BLUE);
drawLine(260, 256, 140, 362, 54, ...BLUE);
// "_" 光标（白色）
drawLine(290, 352, 370, 352, 20, ...WHITE);

// ---------- PNG 编码 ----------
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[o] = px[i];
    raw[o + 1] = px[i + 1];
    raw[o + 2] = px[i + 2];
    raw[o + 3] = px[i + 3];
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.png');
fs.writeFileSync(outPath, png);
console.log('图标已生成: ' + outPath + ' (' + png.length + ' bytes)');
