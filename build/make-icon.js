/** Gjeneron ikonat Windows — logo origjinale e firmës, pa germa RH, sfond i zi. */
const fs = require("fs");
const path = require("path");

const BG = { r: 0, g: 0, b: 0, alpha: 1 };

async function loadLogoSources(sharp, logoSrc) {
  const trimmed = await sharp(logoSrc)
    .trim({ threshold: 8 })
    .png()
    .toBuffer();

  const full = await sharp(logoSrc)
    .trim({ threshold: 4 })
    .png()
    .toBuffer();

  return { full, mark: trimmed };
}

async function renderIcon(sharp, { full, mark }, size, outPath, { useMark = false, fill = 0.92 } = {}) {
  const pad = Math.round(size * (1 - fill) / 2);
  const inner = size - pad * 2;
  const source = useMark ? mark : full;

  const logoBuf = await sharp(source)
    .resize(inner, inner, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: logoBuf, gravity: "center" }])
    .png()
    .toFile(outPath);

  const meta = await sharp(logoBuf).metadata();
  console.log("  ", outPath, `${size}px (${meta.width}x${meta.height})`, useMark ? "[mark]" : "[full]");
}

async function main() {
  const sharp = require("sharp");
  const pngToIco = require("png-to-ico");

  const dir = __dirname;
  const logoSrc = path.join(dir, "..", "public", "img", "revolution-logo.png");
  if (!fs.existsSync(logoSrc)) {
    console.error("Mungon public/img/revolution-logo.png");
    process.exit(1);
  }

  const sources = await loadLogoSources(sharp, logoSrc);

  const specs = [
    { size: 256, useMark: false, fill: 0.94 },
    { size: 128, useMark: false, fill: 0.92 },
    { size: 64, useMark: false, fill: 0.9 },
    { size: 48, useMark: false, fill: 0.88 },
    { size: 32, useMark: true, fill: 0.86 },
    { size: 16, useMark: true, fill: 0.84 },
  ];

  const pngPaths = [];
  for (const spec of specs) {
    const p = path.join(dir, `icon-${spec.size}.png`);
    await renderIcon(sharp, sources, spec.size, p, spec);
    pngPaths.push(p);
  }

  fs.copyFileSync(path.join(dir, "icon-256.png"), path.join(dir, "icon.png"));

  const ico = await pngToIco(pngPaths);
  fs.writeFileSync(path.join(dir, "icon.ico"), ico);
  console.log("OK build/icon.ico", ico.length, "bytes");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
