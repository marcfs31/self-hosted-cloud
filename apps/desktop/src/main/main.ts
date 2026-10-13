import { mkdtempSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { app, Menu, Notification, safeStorage, shell } from "electron";
import { ApiClient } from "../api/client.js";
import { dictionaryFor, resolveLocale } from "../i18n/index.js";
import { SyncEngine } from "../sync/index.js";
import { ConfigStore, type SecretCipher } from "./config-store.js";
import { loadTrayIcon } from "./icons.js";
import { Notifier } from "./notifier.js";
import { allowedExternalUrl } from "./server-url.js";
import { SettingsService } from "./settings-service.js";
import { SettingsWindow } from "./settings-window.js";
import { runSmoke } from "./smoke.js";
import { statusView } from "./status.js";
import { SyncController } from "./sync-controller.js";
import { TrayController } from "./tray.js";

const smoke = process.argv.includes("--smoke");
const appRoot = app.getAppPath();

// A smoke run never touches the real profile (and so never fights a running copy for the lock).
if (smoke) app.setPath("userData", mkdtempSync(join(tmpdir(), "cloud-desktop-smoke-")));

app.setAppUserModelId("cloud.selfhosted.desktop");

/** safeStorage, but never the plain-text fallback some Linux desktops use when no keyring exists. */
const cipher: SecretCipher = {
  isAvailable: () => {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
  },
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (data) => safeStorage.decryptString(data),
};

async function main(): Promise<void> {
  await app.whenReady();
  app.dock?.hide();
  if (process.platform === "darwin") {
    // A menu-bar app still needs the standard Edit menu for copy and paste in the settings form.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }

  const locale = resolveLocale(app.getLocale());
  const dict = dictionaryFor(locale);
  const userData = app.getPath("userData");

  const store = new ConfigStore(userData, cipher, {
    localFolder: join(homedir(), "Cloud"),
    deviceName: hostname(),
  });

  const controller = new SyncController({
    store,
    syncDir: join(userData, "sync"),
    createEngine: (settings) =>
      new SyncEngine({
        api: new ApiClient(settings.server, settings.token),
        localRoot: settings.localRoot,
        stateFile: settings.stateFile,
        clock: { now: () => Date.now() },
        deviceName: settings.deviceName,
        trashItem: (path) => shell.trashItem(path),
      }),
  });

  const toast = (title: string, body: string): void => {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
  };
  const notifier = new Notifier(
    (t) => {
      toast(t.title, t.body);
    },
    () => dict,
  );

  const service = new SettingsService({
    store,
    homeDir: homedir(),
    defaults: { localFolder: join(homedir(), "Cloud"), deviceName: hostname() },
    createApi: (server, token) => new ApiClient(server, token),
    setLaunchAtLogin: (enabled) => {
      // An unpackaged run would register the bare Electron binary as a login item.
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled });
    },
    applyConfig: () => controller.apply(),
  });

  SettingsWindow.hardenSession();
  const settingsWindow = new SettingsWindow({
    appRoot,
    locale,
    dict,
    service,
    getStatus: () => statusView(controller.status, dict),
    devTools: !app.isPackaged,
  });

  if (smoke) {
    await runSmoke({
      assetsDir: join(appRoot, "assets"),
      settingsWindow,
      controller,
      secureStorage: cipher.isAvailable(),
    });
    return;
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    settingsWindow.show();
  });
  // Closing the settings window must not quit a tray app.
  app.on("window-all-closed", () => undefined);

  const openFolder = (): void => {
    const folder = controller.config?.localFolder;
    if (folder === undefined) return;
    void shell.openPath(folder).then((problem) => {
      if (problem !== "") toast(dict.notifications.problemTitle, dict.reasons.local_root_missing);
    });
  };
  const openBrowser = (): void => {
    const server = controller.config?.server;
    const url = server === undefined ? undefined : allowedExternalUrl(`${server}/`, server);
    if (url !== undefined) void shell.openExternal(url.href);
  };

  const tray = new TrayController(loadTrayIcon(join(appRoot, "assets"), process.platform), dict, {
    "open-folder": openFolder,
    "open-browser": openBrowser,
    "toggle-pause": () => {
      controller.togglePause();
    },
    settings: () => {
      settingsWindow.show();
    },
    quit: () => {
      app.quit();
    },
  });

  controller.on("status", (status) => {
    tray.update(status);
    settingsWindow.pushStatus(statusView(status, dict));
    notifier.onStatus(status);
  });
  controller.on("activity", (activity) => {
    notifier.onActivity(activity);
  });
  tray.update(controller.status);

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    notifier.dispose();
    void controller.stop().finally(() => {
      tray.destroy();
      app.exit(0);
    });
  });

  await controller.apply();
  if (controller.status.state === "unconfigured" || controller.status.state === "error") {
    settingsWindow.show();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  app.exit(1);
});
