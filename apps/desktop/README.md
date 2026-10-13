# @cloud/desktop

A menu-bar (tray) app that keeps a folder on this computer in sync with a Self-Hosted Cloud
server. Electron shell around a plain Node sync engine (`src/sync`, `src/api`) that talks to the
API with an app password and the change feed.

- **Tray menu:** status line (Up to date, Syncing N files, Paused, Offline, Error: …), Open cloud
  folder, Open in browser, Pause/Resume, Settings…, Quit.
- **Notifications:** only for conflicts (both versions are kept) and problems, batched, silent.
- **Settings window:** server address (https, or http for localhost), email, app password,
  local folder (default `~/Cloud`), device name, launch at login, Test connection.
- **Languages:** English, Portuguese (Portugal), Spanish, Catalan, Italian, chosen from the
  system language, English otherwise. Strings live in `src/i18n/`.

## Run

```bash
pnpm install
pnpm --filter @cloud/shared build          # once: the app imports the built contract
pnpm --filter @cloud/desktop start         # build + electron .
pnpm --filter @cloud/desktop smoke         # headless check: starts, loads the settings page, prints ok
```

On first start the settings window opens. Create an app password in the web app (Security), enter
it here and press **Test connection**, then **Save**. Syncing starts immediately.

Launch at login is only registered by the packaged app (an unpackaged run would register the bare
Electron binary).

## Package

```bash
pnpm --filter @cloud/desktop package
```

Builds the app, stages it with its production dependencies only (`pnpm deploy`, hoisted layout
so the packager's plain copies stay self-contained) and writes an **unsigned** build for the
current platform and architecture to `apps/desktop/out/` (git-ignored), for example
`out/Cloud-darwin-arm64/Cloud.app`. `pnpm icons` regenerates the tray icons in `assets/`.

There is no application icon yet, so the app bundle, the taskbar and the file manager show the
default Electron icon.

### Opening an unsigned app

- **macOS:** Gatekeeper refuses an app that is not signed and notarised. Right-click the app,
  choose **Open**, then confirm **Open** in the dialog. If it was downloaded, remove the
  quarantine flag once: `xattr -dr com.apple.quarantine Cloud.app`. The app has no Dock icon;
  look for the cloud in the menu bar.
- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info**, then **Run
  anyway**.
- **Linux:** run the `Cloud` binary; the tray needs a desktop with a StatusNotifier/AppIndicator
  tray. Storing the app password needs a keyring (see below).

## Where things live

Electron's per-user data directory, named after the product (`Cloud`):

| Platform | Directory                             |
| -------- | ------------------------------------- |
| macOS    | `~/Library/Application Support/Cloud` |
| Windows  | `%APPDATA%\Cloud`                     |
| Linux    | `~/.config/Cloud`                     |

| File               | Contents                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `config.json`      | Server, email, local folder, device name, launch at login. Never the password.                                                    |
| `credentials.enc`  | The app password, encrypted with Electron `safeStorage` (macOS Keychain, Windows DPAPI, Linux libsecret/kwallet), base64 encoded. |
| `sync/<hash>.json` | Sync state, one file per server, account and folder, so pointing the app at another folder starts from a clean slate.             |

If the system cannot encrypt (for example Linux without a keyring, where Electron would fall back
to plain text), the app refuses to store the password and says so. Files removed by a sync go to
the system trash (`shell.trashItem`), never straight to deletion.

## Security notes

- The settings window runs with `contextIsolation`, `sandbox`, no Node integration, `webSecurity`,
  and a strict CSP (`default-src 'self'`, `connect-src 'none'`). Navigation, `window.open`
  and webviews are blocked, every permission request is denied, and the default session cancels
  all http(s) and websocket requests, so the page can reach nothing but the main process.
- The preload exposes five calls (`getState`, `saveConfig`, `chooseFolder`, `testConnection`,
  `onStatus`). The main process serves them only to the settings page itself and re-validates
  every field the page sends.
- `shell.openExternal` is only called through `allowedExternalUrl`: the configured server's own
  origin, over https (http for localhost), no credentials in the URL.
- The app password is entered once and never sent back to the page.
- No telemetry, no remote code or fonts.

## Layout

| Path                  | What                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `src/main/`           | Electron main process: tray, settings window, controller, config |
| `src/preload/`        | The sandboxed preload (CommonJS, `contextBridge`)                |
| `src/renderer/`       | The settings page script (plain TypeScript, no bundler)          |
| `src/ipc/types.ts`    | The renderer/main contract                                       |
| `src/i18n/`           | Typed dictionaries; `en.ts` is the source                        |
| `src/sync`, `src/api` | The sync engine and API client (no Electron imports)             |
| `assets/`             | Settings page HTML/CSS, tray icons                               |
| `packaging/`          | Icon generator and the packaging script                          |
