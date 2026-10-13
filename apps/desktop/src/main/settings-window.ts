import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import type { Dictionary } from "../i18n/index.js";
import type { Channel, InitialState, StatusView } from "../ipc/types.js";
import type { SettingsService } from "./settings-service.js";
import { loadAppIcon } from "./icons.js";
import { isTrustedSender } from "./trusted-sender.js";

export interface SettingsWindowOptions {
  /** The app's root (where package.json, assets/ and dist/ live). */
  appRoot: string;
  locale: string;
  dict: Dictionary;
  service: SettingsService;
  getStatus(): StatusView;
  devTools: boolean;
}

/** Everything the page may do is an IPC call served here; nothing from the page reaches Node. */
export class SettingsWindow {
  private win: BrowserWindow | undefined;
  private readonly page: string;
  private readonly pageUrl: string;

  constructor(private readonly options: SettingsWindowOptions) {
    this.page = join(options.appRoot, "assets", "settings.html");
    this.pageUrl = pathToFileURL(this.page).href;
    this.registerIpc();
  }

  /** Locks the default session down: no permissions, and no network access from web content at all. */
  static hardenSession(): void {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    ses.setPermissionCheckHandler(() => false);
    ses.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"] },
      (_details, callback) => {
        callback({ cancel: true });
      },
    );
  }

  show(options: { visible?: boolean } = {}): BrowserWindow {
    const existing = this.win;
    if (existing !== undefined && !existing.isDestroyed()) {
      if (options.visible !== false) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        if (process.platform === "darwin") app.focus({ steal: true });
        existing.focus();
      }
      return existing;
    }
    const win = new BrowserWindow({
      width: 540,
      height: 780,
      minWidth: 320,
      minHeight: 480,
      show: false,
      ...(process.platform === "darwin"
        ? {}
        : { icon: loadAppIcon(join(this.options.appRoot, "assets")) }),
      title: this.options.dict.settings.windowTitle,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(this.options.appRoot, "dist", "preload", "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        experimentalFeatures: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        devTools: this.options.devTools,
      },
    });
    this.win = win;
    const contents = win.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    contents.on("will-redirect", (event) => {
      event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    win.once("ready-to-show", () => {
      if (options.visible === false) return;
      win.show();
      // A menu-bar app has no Dock icon to bring it forward.
      if (process.platform === "darwin") app.focus({ steal: true });
    });
    win.on("closed", () => {
      if (this.win === win) this.win = undefined;
    });
    void win.loadFile(this.page);
    return win;
  }

  pushStatus(status: StatusView): void {
    const win = this.win;
    if (win === undefined || win.isDestroyed()) return;
    const channel: Channel = "status:changed";
    win.webContents.send(channel, status);
  }

  private registerIpc(): void {
    const { service } = this.options;
    const guarded = <A extends unknown[], R>(
      handler: (...args: A) => Promise<R> | R,
    ): ((event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<R>) => {
      return async (event, ...args) => {
        if (!isTrustedSender(event.senderFrame?.url, this.pageUrl)) {
          throw new Error("Untrusted sender");
        }
        return handler(...args);
      };
    };

    const getState: Channel = "settings:get-state";
    ipcMain.handle(
      getState,
      guarded(async (): Promise<InitialState> => ({
        locale: this.options.locale,
        strings: this.options.dict.settings,
        config: await service.view(),
        status: this.options.getStatus(),
      })),
    );
    const save: Channel = "settings:save";
    ipcMain.handle(
      save,
      guarded((raw: unknown) => service.save(raw)),
    );
    const test: Channel = "settings:test-connection";
    ipcMain.handle(
      test,
      guarded((raw: unknown) => service.test(raw)),
    );
    const choose: Channel = "settings:choose-folder";
    ipcMain.handle(
      choose,
      guarded(async (): Promise<string | null> => {
        const view = await service.view();
        const parent = this.win;
        const options = {
          defaultPath: view.localFolder,
          properties: ["openDirectory" as const, "createDirectory" as const],
        };
        const result =
          parent !== undefined && !parent.isDestroyed()
            ? await dialog.showOpenDialog(parent, options)
            : await dialog.showOpenDialog(options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      }),
    );
  }
}
