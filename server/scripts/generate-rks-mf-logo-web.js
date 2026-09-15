/**
 * Gjeneron logo_rks_mf.png (160×80) për raportet web — RKS / MF, pa varësi nga skedar referencë.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_W = 160;
const OUT_H = 80;

const FONT = {
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
};

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return out;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, typeBuf, data, crc32(Buffer.concat([typeBuf, data]))]);
}

function setBlack(out, x, y) {
  if (x < 0 || y < 0 || x >= OUT_W || y >= OUT_H) return;
  const di = (y * OUT_W + x) * 4;
  out[di] = 0;
  out[di + 1] = 0;
  out[di + 2] = 0;
  out[di + 3] = 255;
}

function blitGlyph(out, ox, oy, ch, scale) {
  const g = FONT[ch];
  if (!g) return 5 * scale;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (g[row][col] !== "1") continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          setBlack(out, ox + col * scale + dx, oy + row * scale + dy);
        }
      }
    }
  }
  return 5 * scale;
}

function drawTextBlock(out, lines, x0, y0, scale, gapY, letterGap) {
  let y = y0;
  for (const line of lines) {
    let x = x0;
    for (let i = 0; i < line.length; i++) {
      x += blitGlyph(out, x, y, line[i], scale) + letterGap;
    }
    y += 7 * scale + gapY;
  }
}

function composeLogo() {
  const out = Buffer.alloc(OUT_W * OUT_H * 4, 255);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;

  const scaleT = 5;
  const letterGap = 4;
  const lineGap = 4;
  const lineW = 3 * 5 * scaleT + 2 * letterGap;
  const blockH = 2 * 7 * scaleT + lineGap;
  const tx = Math.floor((OUT_W - lineW) / 2);
  const ty = Math.floor((OUT_H - blockH) / 2);
  drawTextBlock(out, ["RKS", "MF"], tx, ty, scaleT, lineGap, letterGap);
  return out;
}

function encodePng(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(OUT_W, 0);
  ihdr.writeUInt32BE(OUT_H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = OUT_W * 3;
  const raw = Buffer.alloc((stride + 1) * OUT_H);
  for (let y = 0; y < OUT_H; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < OUT_W; x++) {
      const si = (y * OUT_W + x) * 4;
      const di = y * (stride + 1) + 1 + x * 3;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "public", "assets");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "logo_rks_mf.png");
fs.writeFileSync(outPath, encodePng(composeLogo()));
console.log("OK", outPath);
