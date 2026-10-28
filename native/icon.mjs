// Draws the viniva mark: a v in two bold slanted strokes with a gap between
// them, the right one reaching lower, on the green. Writes the SVG and renders
// PNGs at the sizes the web app, iOS and Android want, into a folder:
//   node native/icon.mjs /tmp/icon
// then copy icon.svg, icon-192/512.png and apple-touch-icon.png to icons/,
// AppIcon-512@2x.png to the iOS AppIcon set, and the android-* files to the
// matching android/app/src/main/res/mipmap-* folders (name without prefix).
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const { launch } = createRequire(import.meta.url)("../test/browser.js");

const GREEN = "#0a8f5b";
const out = process.argv[2] || ".";
mkdirSync(out, { recursive: true });

// The mark, traced from the reference picture (519×415) and scaled to sit
// centred in the 1024 box: two bold slanted strokes with a gap between
// them, the right one reaching the bottom. White on the green.
const SRC_W = 506, SRC_H = 349, SRC_X = 6, SRC_Y = 40;   // the picture's bounding box
const SCALE = 780 / SRC_W;                                 // 76% of the icon's width
const OX = (1024 - SRC_W * SCALE) / 2, OY = (1024 - SRC_H * SCALE) / 2;
// Mirrored: the stroke that reaches the bottom is the right one.
const place = ([x, y]) => [OX + (SRC_X + SRC_W - x) * SCALE, OY + (y - SRC_Y) * SCALE];
const left = [[6, 40], [120, 41], [282, 377], [274, 389], [173, 389]].map(place);
const right = [[240, 262], [391, 40], [512, 41], [290, 365]].map(place);
const pts = (p) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
const glyph = () => `
  <polygon points="${pts(left)}" fill="#ffffff"/>
  <polygon points="${pts(right)}" fill="#ffffff"/>`;
const shade = `<defs><linearGradient id="g" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse"><stop stop-color="#ffffff" stop-opacity="0.14"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>`;
const svg = (rx, transform = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  ${shade}
  <rect width="1024" height="1024" rx="${rx}" fill="${GREEN}"/>
  <rect width="1024" height="1024" rx="${rx}" fill="url(#g)"/>
  <g${transform ? ` transform="${transform}"` : ""}>${glyph()}</g>
</svg>`;

const rounded = svg(224);   // web: the shape a home-screen icon has
const square = svg(0);      // iOS: Apple rounds it; Android: masked by the launcher
// Android adaptive foreground: the launcher shows the middle 66% of a 108dp
// canvas, so the glyph sits inside that safe zone.
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><g transform="translate(512 512) scale(0.62) translate(-512 -512)">${glyph()}</g></svg>`;

writeFileSync(`${out}/icon.svg`, rounded.replace('width="1024" height="1024"', 'width="512" height="512"'));
writeFileSync(`${out}/icon-square.svg`, square);
writeFileSync(`${out}/icon-foreground.svg`, foreground);

const browser = await launch();
const page = await browser.newPage();
async function render(markup, size, file, transparent = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${transparent ? "transparent" : GREEN}">${markup.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: `${out}/${file}`, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
}
await render(rounded, 1024, "preview.png", true);
await render(rounded, 512, "icon-512.png", true);
await render(rounded, 192, "icon-192.png", true);
await render(square, 180, "apple-touch-icon.png");
await render(square, 1024, "AppIcon-512@2x.png");
for (const [d, s] of [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]]) {
  await render(square, s, `android-${d}-ic_launcher.png`);
  await render(rounded.replace('rx="224"', 'rx="512"').replace('rx="224"', 'rx="512"'), s, `android-${d}-ic_launcher_round.png`, true);
  await render(foreground, Math.round(s * 108 / 48), `android-${d}-ic_launcher_foreground.png`, true);
}
await browser.close();
console.log("done");
