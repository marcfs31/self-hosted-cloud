import { join } from "node:path";
import { nativeImage, type NativeImage } from "electron";

/**
 * macOS gets a template image (black with alpha, tinted by the menu bar); the other platforms get
 * a coloured one that reads on light and dark taskbars. "@2x" siblings are picked up by Electron.
 */
export function loadTrayIcon(assetsDir: string, platform: NodeJS.Platform): NativeImage {
  const image = nativeImage.createFromPath(
    join(assetsDir, platform === "darwin" ? "trayTemplate.png" : "tray.png"),
  );
  if (image.isEmpty()) throw new Error("The tray icon could not be loaded.");
  if (platform === "darwin") image.setTemplateImage(true);
  return image;
}
