/*
 * The settings page. A classic script (no imports, no bundler): the shapes it shares with the main
 * process are referenced as types only, and every string arrives translated from the main process.
 */
type DesktopApi = import("../ipc/types.js").DesktopApi;
type SettingsInput = import("../ipc/types.js").SettingsInput;
type SettingsView = import("../ipc/types.js").SettingsView;
type StatusView = import("../ipc/types.js").StatusView;
type FieldError = import("../ipc/types.js").FieldError;
type FieldName = import("../ipc/types.js").FieldName;
type Strings = import("../ipc/types.js").InitialState["strings"];

(() => {
  const FIELDS = ["server", "email", "appPassword", "localFolder", "deviceName"] as const;

  const desktop = (window as unknown as { desktop: DesktopApi }).desktop;

  function el<T extends HTMLElement>(id: string, type: new () => T): T {
    const found = document.getElementById(id);
    if (!(found instanceof type)) throw new Error(`Missing element #${id}`);
    return found;
  }

  const form = el("form", HTMLFormElement);
  const launch = el("launchAtLogin", HTMLInputElement);
  const inputs = {
    server: el("server", HTMLInputElement),
    email: el("email", HTMLInputElement),
    appPassword: el("appPassword", HTMLInputElement),
    localFolder: el("localFolder", HTMLInputElement),
    deviceName: el("deviceName", HTMLInputElement),
    launchAtLogin: launch,
  };
  const choose = el("choose", HTMLButtonElement);
  const test = el("test", HTMLButtonElement);
  const save = el("save", HTMLButtonElement);
  const statusText = el("status-text", HTMLElement);
  const statusDot = el("status-dot", HTMLElement);
  const result = el("result", HTMLElement);
  const formError = el("form-error", HTMLElement);
  const passwordHint = el("appPassword-hint", HTMLElement);

  let strings: Strings | undefined;

  function fill(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
  }

  function text(key: string): string {
    const value: unknown = (strings as unknown as Record<string, unknown> | undefined)?.[key];
    if (typeof value !== "string") throw new Error(`Missing string "${key}"`);
    return value;
  }

  function applyStrings(): void {
    for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
      node.textContent = text(node.dataset.i18n ?? "");
    }
    document.title = text("windowTitle");
  }

  function errorBox(field: FieldName): HTMLElement {
    return field === "form" ? formError : el(`${field}-error`, HTMLElement);
  }

  function clearErrors(): void {
    formError.hidden = true;
    formError.textContent = "";
    for (const name of FIELDS) {
      const box = errorBox(name);
      box.hidden = true;
      box.textContent = "";
      inputs[name].removeAttribute("aria-invalid");
    }
  }

  function showErrors(errors: FieldError[]): void {
    clearErrors();
    const validation = (strings as Strings).validation;
    let focused = false;
    for (const error of errors) {
      const box = errorBox(error.field);
      box.textContent = validation[error.code];
      box.hidden = false;
      if (error.field !== "form") {
        const input = inputs[error.field];
        input.setAttribute("aria-invalid", "true");
        if (!focused) {
          input.focus();
          focused = true;
        }
      }
    }
  }

  function say(message: string, kind: "ok" | "problem" | "neutral"): void {
    result.textContent = message;
    result.dataset.kind = kind;
  }

  function showConfig(view: SettingsView): void {
    inputs.server.value = view.server;
    inputs.email.value = view.email;
    inputs.localFolder.value = view.localFolder;
    inputs.deviceName.value = view.deviceName;
    launch.checked = view.launchAtLogin;
    inputs.appPassword.value = "";
    inputs.appPassword.placeholder = view.hasAppPassword ? "••••••••" : "";
    inputs.appPassword.disabled = !view.secureStorage;
    passwordHint.textContent = view.hasAppPassword ? text("passwordSaved") : text("passwordHint");
    if (!view.secureStorage) {
      formError.textContent = (strings as Strings).validation.secure_storage_unavailable;
      formError.hidden = false;
    }
  }

  function showStatus(status: StatusView): void {
    statusText.textContent = status.label;
    statusDot.dataset.state = status.state;
  }

  function read(): SettingsInput {
    return {
      server: inputs.server.value,
      email: inputs.email.value,
      appPassword: inputs.appPassword.value,
      localFolder: inputs.localFolder.value,
      deviceName: inputs.deviceName.value,
      launchAtLogin: launch.checked,
    };
  }

  function busy(on: boolean): void {
    form.setAttribute("aria-busy", String(on));
    for (const button of [choose, test, save]) button.disabled = on;
  }

  choose.addEventListener("click", () => {
    void desktop.chooseFolder().then((folder) => {
      if (folder !== null) inputs.localFolder.value = folder;
    });
  });

  test.addEventListener("click", () => {
    clearErrors();
    say(text("testing"), "neutral");
    busy(true);
    void desktop
      .testConnection(read())
      .then((outcome) => {
        const connection = (strings as Strings).connection;
        switch (outcome.result) {
          case "ok":
            say(fill(connection.ok, { email: outcome.email }), "ok");
            break;
          case "rejected":
            say(fill(connection[outcome.code], { email: outcome.email ?? "" }), "problem");
            break;
          case "unavailable":
            say(connection[outcome.code], "problem");
            break;
          case "invalid":
            say("", "neutral");
            showErrors(outcome.errors);
            break;
        }
      })
      .catch(() => {
        say(text("unexpected"), "problem");
      })
      .finally(() => {
        busy(false);
      });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors();
    say(text("saving"), "neutral");
    busy(true);
    void desktop
      .saveConfig(read())
      .then((saved) => {
        if (saved.ok) {
          showConfig(saved.config);
          say(text("saved"), "ok");
        } else {
          say("", "neutral");
          showErrors(saved.errors);
        }
      })
      .catch(() => {
        say(text("unexpected"), "problem");
      })
      .finally(() => {
        busy(false);
      });
  });

  desktop.onStatus(showStatus);

  void desktop.getState().then((state) => {
    strings = state.strings;
    document.documentElement.lang = state.locale;
    applyStrings();
    showConfig(state.config);
    showStatus(state.status);
    inputs.server.focus();
  });
})();
