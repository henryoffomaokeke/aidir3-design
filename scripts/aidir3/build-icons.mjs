// Renders the aidir3 app icons from one definition of the "A3" mark, so the
// favicon, the installable-app tiles, the push badge and the static brand
// SVGs all stay the same drawing.
//
//   node scripts/aidir3/build-icons.mjs
//
// Writes into frontend/public. favicon.ico is not produced here (sharp cannot
// write .ico); it is a committed copy of the aidir3.com favicon.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC = join(ROOT, "frontend", "public");
const sharp = createRequire(join(ROOT, "frontend", "package.json"))("sharp");

const EMBER = "#FF5A1F";
const INK = "#0B0C0E";
const PAPER = "#EDEEF0";

// The lettering on a 64-unit box (the same paths as components/ui/Logo.tsx).
const letter = (color) =>
  `<path fill="${color}" d="M9 47L21 15h8l12 32h-7.4l-2.2-6.6H18.6L16.4 47H9zm11.3-12.4h9.4L25 21.6l-4.7 13z"/>` +
  `<path fill="none" stroke="${color}" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round" d="M41 19h9.5c3.7 0 6 2 6 5.1s-2.6 5.4-6.3 5.4H44m0 0h7c3.9 0 6.5 2.3 6.5 5.7S54.9 41 50.5 41H41"/>`;

const svg = (body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="aidir3"${extra}>${body}</svg>\n`;

// Rounded tile: the favicon and the "any" purpose icons.
const tile = svg(`<rect width="64" height="64" rx="13" fill="${EMBER}"/>${letter(INK)}`);
// Maskable: full-bleed ground with the lettering inside the 80% safe zone.
const maskable = svg(`<rect width="64" height="64" fill="${EMBER}"/><g transform="translate(8 8) scale(0.75)">${letter(INK)}</g>`);
// Push badge: a single-colour silhouette on transparency (Android tints it).
const badge = svg(letter("#FFFFFF"));
const markInk = svg(letter(INK));
const markPaper = svg(letter(PAPER));
// Loading mark: the tile with a soft pulse, for the full-screen loader.
const loader = svg(
  `<rect width="64" height="64" rx="13" fill="${EMBER}"><animate attributeName="opacity" values="1;0.55;1" dur="1.4s" repeatCount="indefinite"/></rect>${letter(INK)}`,
  ` width="96" height="96"`,
).replace('aria-label="aidir3"', 'aria-label="aidir3 Design is loading"');

const write = (rel, text) => {
  const file = join(PUBLIC, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

write("favicon.svg", tile);
write("brand/visitor-tile.svg", tile);
write("brand/visitor-avatar.svg", maskable);
write("brand/visitor-mark-ink.svg", markInk);
write("brand/visitor-mark-paper.svg", markPaper);
write("brand/visitor-loader.svg", loader);

const png = (source, size, rel) => sharp(Buffer.from(source), { density: 600 }).resize(size, size).png().toFile(join(PUBLIC, rel));

await Promise.all([
  png(tile, 16, "favicon-16.png"),
  png(tile, 32, "favicon-32.png"),
  png(maskable, 180, "apple-touch-icon.png"),
  png(tile, 192, "icon-192.png"),
  png(tile, 512, "icon-512.png"),
  png(maskable, 192, "icon-maskable-192.png"),
  png(maskable, 512, "icon-maskable-512.png"),
  png(badge, 72, "badge-72.png"),
]);

// Social share card, 1200x630: the mark and the product name on graphite.
const card =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">` +
  `<rect width="1200" height="630" fill="#0A0B0D"/>` +
  `<circle cx="1040" cy="120" r="320" fill="${EMBER}" opacity="0.10"/>` +
  `<g transform="translate(96 150) scale(2.2)"><rect width="64" height="64" rx="13" fill="${EMBER}"/>${letter(INK)}</g>` +
  `<text x="96" y="400" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="92" font-weight="800" fill="${PAPER}" letter-spacing="-3">aidir<tspan fill="${EMBER}">3</tspan> Design</text>` +
  `<text x="98" y="468" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="34" font-weight="500" fill="#A6ADB8">Graphics, presentations, video, whiteboards and documents.</text>` +
  `</svg>`;
await sharp(Buffer.from(card)).png().toFile(join(PUBLIC, "og-image.png"));

console.log("build-icons: wrote favicon.svg, brand/*.svg, 8 PNG icons and og-image.png");
