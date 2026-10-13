import { Menu, Tray, type MenuItemConstructorOptions, type NativeImage } from "electron";
import type { Dictionary } from "../i18n/index.js";
import type { ShellStatus } from "./status.js";
import { trayModel, trayTooltip, type TrayAction } from "./tray-model.js";

export type TrayHandlers = Record<TrayAction, () => void>;

/** The tray icon and its menu; what the menu says comes from trayModel. */
export class TrayController {
  private readonly tray: Tray;

  constructor(
    icon: NativeImage,
    private readonly dict: Dictionary,
    private readonly handlers: TrayHandlers,
  ) {
    this.tray = new Tray(icon);
  }

  update(status: ShellStatus): void {
    const template = trayModel(status, this.dict).map((item): MenuItemConstructorOptions => {
      switch (item.kind) {
        case "separator":
          return { type: "separator" };
        case "status":
          return { label: item.label, enabled: false };
        case "action":
          return {
            label: item.label,
            enabled: item.enabled,
            click: () => {
              this.handlers[item.action]();
            },
          };
      }
    });
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
    this.tray.setToolTip(trayTooltip(status, this.dict));
  }

  destroy(): void {
    this.tray.destroy();
  }
}
