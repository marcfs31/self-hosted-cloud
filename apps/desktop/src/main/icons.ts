import { join } from "node:path";
import { nativeImage, type NativeImage } from "electron";

/**
 * The application icon for windows on Windows and Linux (macOS takes it from the app bundle, and
 * this app has no Dock icon). The packager embeds icon.ico / icon.icns into the executable.
 */
export function loadAppIcon(assetsDir: string): NativeImage {
  const image = nativeImage.createFromPath(join(assetsDir, "icon.png"));
  if (image.isEmpty()) throw new Error("The application icon could not be loaded.");
  return image;
}

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
