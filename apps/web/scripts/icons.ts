/*
 * Renders public/icons/icon.svg to the PNG icons of the web app manifest, using the Chromium
 * that Playwright already installs for the e2e tests. Run it by hand after changing the SVG:
 *
 *   pnpm --filter @cloud/web icons
 *
 * The PNGs are committed. The maskable icon is full-bleed (no rounded corners) because the
 * operating system applies its own mask; the glyph already sits inside the safe zone.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const source = fileURLToPath(new URL("../public/icons/icon.svg", import.meta.url));

interface Target {
  file: string;
  size: number;
  maskable: boolean;
}

const targets: Target[] = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

const browser = await chromium.launch();
try {
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: target.size, height: target.size } });
    await page.goto(pathToFileURL(source).href);
    if (target.maskable) {
      await page.evaluate(() => {
        document.getElementById("background")?.setAttribute("rx", "0");
      });
    }
    await page.screenshot({
      path: fileURLToPath(new URL(`../public/icons/${target.file}`, import.meta.url)),
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
