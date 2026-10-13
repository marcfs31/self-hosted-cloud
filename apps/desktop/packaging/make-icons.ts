/*
 * Regenerates the tray and application icons in assets/ from one shape definition (no image
 * libraries):  node packaging/make-icons.ts
 * trayTemplate*.png: black with alpha, a macOS template image. tray*.png: coloured, for Windows
 * and Linux. cloud.svg is the same shape as vector source.
 * icon.svg / icon.png (1024) / icon.ico: the application icon, a white cloud on a blue rounded
 * square. icon.icns is built with macOS `iconutil` from a generated .iconset, so it is only
 * refreshed when this runs on a Mac; the committed file is used otherwise.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { packIco } from "./ico.ts";

/** A cloud on a 16 x 16 grid: three circles and a flat base. */
const CIRCLES = [
  { x: 4.6, y: 9.7, r: 2.9 },
  { x: 8.0, y: 7.3, r: 3.9 },
  { x: 11.6, y: 9.5, r: 3.1 },
] as const;
const BASE = { x: 4.6, y: 9.7, width: 7.0, height: 2.9 } as const;

function inside(px: number, py: number): boolean {
  if (CIRCLES.some((c) => (px - c.x) ** 2 + (py - c.y) ** 2 <= c.r ** 2)) return true;
  return px >= BASE.x && px <= BASE.x + BASE.width && py >= BASE.y && py <= BASE.y + BASE.height;
}

const SAMPLES = 8;

function render(size: number, rgb: readonly [number, number, number]): Buffer {
  const scale = 16 / size;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (x + (sx + 0.5) / SAMPLES) * scale;
          const py = (y + (sy + 0.5) / SAMPLES) * scale;
          if (inside(px, py)) hits++;
        }
      }
      const at = row + 1 + x * 4;
      raw[at] = rgb[0];
      raw[at + 1] = rgb[1];
      raw[at + 2] = rgb[2];
      raw[at + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return encodePng(size, raw);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size: number, raw: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The application icon on a 1024 grid: macOS-style inset rounded square (824 px, 185 px radius,
 * vertical blue gradient) with the same white cloud, centred.
 */
const TILE = { inset: 100, size: 824, radius: 185 } as const;
const GRADIENT = { top: [111, 155, 255], bottom: [58, 99, 224] } as const;
const CLOUD_BOX = { cx: 8.1, cy: 8.0, scale: 44 } as const; // 16-grid centre and pixels per unit

function inTile(px: number, py: number): boolean {
  const { inset, size, radius } = TILE;
  const x = Math.min(Math.max(px, inset + radius), inset + size - radius);
  const y = Math.min(Math.max(py, inset + radius), inset + size - radius);
  return (px - x) ** 2 + (py - y) ** 2 <= radius ** 2;
}

function inCloudAt1024(px: number, py: number): boolean {
  return inside(
    (px - 512) / CLOUD_BOX.scale + CLOUD_BOX.cx,
    (py - 512) / CLOUD_BOX.scale + CLOUD_BOX.cy,
  );
}

function renderApp(size: number): Buffer {
  const samples = size >= 512 ? 4 : 8;
  const scale = 1024 / size;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = (x + (sx + 0.5) / samples) * scale;
          const py = (y + (sy + 0.5) / samples) * scale;
          if (!inTile(px, py)) continue;
          alpha++;
          const t = (py - TILE.inset) / TILE.size;
          if (inCloudAt1024(px, py)) {
            red += 255;
            green += 255;
            blue += 255;
          } else {
            red += GRADIENT.top[0] + (GRADIENT.bottom[0] - GRADIENT.top[0]) * t;
            green += GRADIENT.top[1] + (GRADIENT.bottom[1] - GRADIENT.top[1]) * t;
            blue += GRADIENT.top[2] + (GRADIENT.bottom[2] - GRADIENT.top[2]) * t;
          }
        }
      }
      const at = row + 1 + x * 4;
      raw[at] = alpha === 0 ? 0 : Math.round(red / alpha);
      raw[at + 1] = alpha === 0 ? 0 : Math.round(green / alpha);
      raw[at + 2] = alpha === 0 ? 0 : Math.round(blue / alpha);
      raw[at + 3] = Math.round((alpha / (samples * samples)) * 255);
    }
  }
  return encodePng(size, raw);
}

function appSvg(): string {
  const { inset, size, radius } = TILE;
  const { scale, cx, cy } = CLOUD_BOX;
  const circles = CIRCLES.map((c) => `<circle cx="${c.x}" cy="${c.y}" r="${c.r}"/>`).join("");
  const base = `<rect x="${BASE.x}" y="${BASE.y}" width="${BASE.width}" height="${BASE.height}"/>`;
  const [r1, g1, b1] = GRADIENT.top;
  const [r2, g2, b2] = GRADIENT.bottom;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${r1},${g1},${b1})"/><stop offset="1" stop-color="rgb(${r2},${g2},${b2})"/></linearGradient></defs><rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/><g fill="#fff" transform="translate(512 512) scale(${scale}) translate(${-cx} ${-cy})">${circles}${base}</g></svg>\n`;
}

function svg(): string {
  const circles = CIRCLES.map((c) => `<circle cx="${c.x}" cy="${c.y}" r="${c.r}"/>`).join("");
  const base = `<rect x="${BASE.x}" y="${BASE.y}" width="${BASE.width}" height="${BASE.height}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><g fill="#000">${circles}${base}</g></svg>\n`;
}

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(assets, { recursive: true });
const BLACK = [0, 0, 0] as const;
const BLUE = [79, 124, 255] as const;
writeFileSync(join(assets, "trayTemplate.png"), render(16, BLACK));
writeFileSync(join(assets, "trayTemplate@2x.png"), render(32, BLACK));
writeFileSync(join(assets, "tray.png"), render(16, BLUE));
writeFileSync(join(assets, "tray@2x.png"), render(32, BLUE));
writeFileSync(join(assets, "cloud.svg"), svg());

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
writeFileSync(join(assets, "icon.svg"), appSvg());
writeFileSync(join(assets, "icon.png"), renderApp(1024));
writeFileSync(
  join(assets, "icon.ico"),
  packIco(ICO_SIZES.map((size) => ({ size, png: renderApp(size) }))),
);

if (process.platform === "darwin") {
  const iconset = join(assets, "icon.iconset");
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset);
  // iconutil's required names: icon_<n>x<n>.png and icon_<n>x<n>@2x.png (2n pixels).
  for (const n of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${n}x${n}.png`), renderApp(n));
    writeFileSync(join(iconset, `icon_${n}x${n}@2x.png`), renderApp(n * 2));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(assets, "icon.icns")]);
  rmSync(iconset, { recursive: true, force: true });
}
console.log("wrote tray and application icons to", assets);
