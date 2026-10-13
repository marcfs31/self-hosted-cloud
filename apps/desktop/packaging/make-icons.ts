/*
 * Regenerates the tray icons in assets/ from one shape definition (no image libraries):
 *   node packaging/make-icons.ts
 * trayTemplate*.png: black with alpha, a macOS template image. tray*.png: coloured, for Windows
 * and Linux. cloud.svg is the same shape as vector source.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

/** A cloud on a 16 x 16 grid: three circles and a flat base. */
const CIRCLES = [
  { x: 4.6, y: 9.7, r: 2.9 },
  { x: 8.0, y: 7.3, r: 3.9 },
  { x: 11.6, y: 9.5, r: 3.0 },
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
console.log("wrote tray icons to", assets);
