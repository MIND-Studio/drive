/*
 * Generates Drive's brand icons from the canonical Mind mark.
 *
 * The artwork is imported from `@mind-studio/ui/brand` — the design system's
 * single source of truth — so these icons can never drift from the published
 * logo. Drive shares the one Mind mark (icons are mark-only). Re-run after
 * bumping the package: `npm run gen:icons`.
 *
 * Outputs:
 *   src/app/icon.svg        favicon — gradient weave, transparent, square
 *   src/app/apple-icon.png  180×180 apple-touch — white mark on green, 22% radius
 *   public/icon-192.png     192×192 maskable — white mark on full-bleed green
 *   public/icon-512.png     512×512 maskable — white mark on full-bleed green
 *
 * The maskable icons bleed the green to the edges (the platform mask crops the
 * corners) and keep the mark inside the ~80% safe zone.
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIND_GREEN, MIND_MARK_SVG, monoMarkSvg } from "@mind-studio/ui/brand";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const out = (p) => resolve(root, p);

// Brand green backplate (the solid surface behind the white mono mark).
const GREEN = MIND_GREEN.base; // #16B88A

/* ---------------------------------------------------------------- favicon.svg */
// Nest the full-colour mark inside a square canvas, centred with a little
// breathing room (meet → preserves the mark's aspect, no distortion).
const nested = MIND_MARK_SVG.replace(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1117 1000"',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1117 1000" x="6" y="6" width="88" height="88" preserveAspectRatio="xMidYMid meet"',
);
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Mind">
${nested}
</svg>
`;
writeFileSync(out("src/app/icon.svg"), faviconSvg, "utf8");

/* ------------------------------------------------------------------ raster ops */
// Rasterise the monochrome mark to a transparent square of the given size.
async function rasterMark(px, color = "#ffffff") {
  return sharp(Buffer.from(monoMarkSvg(color)))
    .resize(px, px, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// Maskable: white mark on a full-bleed green square; mark kept in the safe zone.
async function maskable(size, file) {
  const mark = await rasterMark(Math.round(size * 0.66));
  await sharp({ create: { width: size, height: size, channels: 4, background: GREEN } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(out(file));
}

// Apple touch: white mark on a green backplate with a 22% corner radius.
async function appleIcon(size, file) {
  const r = Math.round(size * 0.22);
  const backplate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${GREEN}"/></svg>`,
  );
  const mark = await rasterMark(Math.round(size * 0.62));
  await sharp(backplate).composite([{ input: mark, gravity: "center" }]).png().toFile(out(file));
}

await Promise.all([
  maskable(192, "public/icon-192.png"),
  maskable(512, "public/icon-512.png"),
  appleIcon(180, "src/app/apple-icon.png"),
]);

console.log("[gen:icons] wrote icon.svg, apple-icon.png, icon-192.png, icon-512.png");
