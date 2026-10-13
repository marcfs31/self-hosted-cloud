/*
 * Runs in the sandboxed preload context, which can only require "electron": this file must stay a
 * single CommonJS module with type-only imports. It exposes the minimal API the settings page
 * needs; the page never sees ipcRenderer.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Channel, DesktopApi, StatusView } from "../ipc/types.js";

function invoke<T>(channel: Channel, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api: DesktopApi = {
  getState: () => invoke("settings:get-state"),
  saveConfig: (input) => invoke("settings:save", input),
  chooseFolder: () => invoke("settings:choose-folder"),
  testConnection: (input) => invoke("settings:test-connection", input),
  onStatus: (listener) => {
    const channel: Channel = "status:changed";
    const handler = (_event: IpcRendererEvent, status: StatusView): void => {
      listener(status);
    };
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
};

contextBridge.exposeInMainWorld("desktop", api);
