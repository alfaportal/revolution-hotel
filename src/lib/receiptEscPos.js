/** ESC/POS komanda për printer termal 58mm / 80mm */

const ESC = 0x1b;
const GS = 0x1d;

function buf(bytes) {
  return Buffer.from(bytes);
}

function text(str) {
  return Buffer.from(String(str ?? ""), "utf8");
}

function concat(...parts) {
  return Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : text(p))));
}

function init() {
  return buf([ESC, 0x40]);
}

function bold(on = true) {
  return buf([ESC, 0x45, on ? 1 : 0]);
}

function align(mode = 0) {
  return buf([ESC, 0x61, mode]);
}

function size(mode = 0) {
  return buf([GS, 0x21, mode]);
}

function cut(partial = false) {
  return buf([GS, 0x56, partial ? 1 : 0]);
}

function cutWithFeed() {
  return buf([GS, 0x56, 0x42, 0x00]);
}

function feedLines(n = 3) {
  return buf([ESC, 0x64, Math.max(0, Math.min(255, n))]);
}

function feed(lines = 3) {
  return text("\n".repeat(Math.max(1, lines)));
}

function line(str = "") {
  return concat(text(str), text("\n"));
}

function latinizeForEscPos(str) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/€/g, " EUR")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function appendEscPosCut(buffer) {
  const base = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  return concat(base, feedLines(3), cutWithFeed());
}

/**
 * Ndërton buffer ESC/POS nga rreshta plain-text me markime speciale:
 * ^B = bold, ^C = center, ^R = right, ^L = large (2x height)
 */
function buildEscPosFromLines(lines) {
  const chunks = [init()];

  for (const raw of lines) {
    let s = String(raw ?? "");
    const resets = [];

    if (!s) {
      chunks.push(line());
      continue;
    }

    if (s.startsWith("^C")) {
      chunks.push(align(1));
      resets.push(align(0));
      s = s.slice(2);
    } else if (s.startsWith("^R")) {
      chunks.push(align(2));
      resets.push(align(0));
      s = s.slice(2);
    }

    if (s.startsWith("^L")) {
      chunks.push(size(0x11));
      resets.unshift(size(0));
      s = s.slice(2);
    }

    if (s.startsWith("^B")) {
      chunks.push(bold(true));
      resets.unshift(bold(false));
      s = s.slice(2);
    }

    s = latinizeForEscPos(s.replace(/\^b/g, ""));
    chunks.push(text(s), text("\n"), ...resets);
  }

  return appendEscPosCut(concat(...chunks));
}

function toBase64(buffer) {
  return buffer.toString("base64");
}

module.exports = {
  init,
  bold,
  align,
  size,
  cut,
  cutWithFeed,
  feed,
  feedLines,
  line,
  appendEscPosCut,
  buildEscPosFromLines,
  toBase64,
};
