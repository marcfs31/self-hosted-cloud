/*
 * English is the source: every other locale is typed from `Dictionary`, and i18n.test.ts fails on
 * a missing, empty or untranslated value or on a placeholder that differs from this file.
 * Placeholders are written {name}.
 */
export const en = {
  tray: {
    tooltip: "Cloud: {status}",
    statusIdle: "Up to date",
    statusSyncing: "Syncing…",
    statusSyncingOne: "Syncing 1 file",
    statusSyncingMany: "Syncing {count} files",
    statusPaused: "Paused",
    statusOffline: "Offline",
    statusError: "Error: {reason}",
    statusNotConfigured: "Not set up yet",
    openFolder: "Open cloud folder",
    openBrowser: "Open in browser",
    pause: "Pause syncing",
    resume: "Resume syncing",
    settings: "Settings…",
    quit: "Quit Cloud",
  },
  notifications: {
    conflictOneTitle: "Both versions were kept",
    conflictOneBody: "{name} changed on two computers. A copy sits next to the original.",
    conflictManyTitle: "{count} files changed in two places",
    conflictManyBody:
      "Both versions of each file were kept. Look for the copies next to the originals.",
    problemTitle: "Syncing needs a look",
    problemBody: "{reason}",
    problemItemsBody: "{count} items could not be synced. {reason}",
  },
  reasons: {
    unauthenticated: "The server did not accept the app password. Enter a new one in Settings.",
    account_changed:
      "This folder was synced with a different account. Choose another folder in Settings.",
    local_root_missing:
      "The cloud folder cannot be found. Reconnect the drive or choose the folder again.",
    config_damaged: "The saved settings could not be read. Enter them again in Settings.",
    credentials_unreadable:
      "The saved app password could not be unlocked. Enter it again in Settings.",
    quota_exceeded: "Your cloud storage is full.",
    case_collision: "Two names differ only by upper and lower case.",
    invalid_name: "The name is not allowed on the server.",
    name_conflict: "An item with that name already exists.",
    changed_during_sync: "The file changed while it was syncing.",
    too_many_attempts: "Too many attempts. Syncing will try again shortly.",
    origin_rejected: "The server refused the request.",
    internal: "The server had a problem. Syncing will try again.",
    EACCES: "Permission to use the file was denied.",
    EPERM: "Permission to use the file was denied.",
    ENOSPC: "The disk is full.",
    EBUSY: "The file is in use by another program.",
    unknown: "Something unexpected happened.",
  },
  settings: {
    windowTitle: "Cloud settings",
    heading: "Connect to your cloud",
    intro: "Files in the folder below stay in sync with your own server.",
    statusLabel: "Status",
    serverLabel: "Server address",
    serverHint: "For example https://cloud.example.com. Plain http is only accepted for localhost.",
    emailLabel: "Email",
    passwordLabel: "App password",
    passwordHint:
      "Create one in the web app under Security. It is stored encrypted by your system and never shown again.",
    passwordSaved: "A password is saved. Leave this empty to keep it.",
    folderLabel: "Local folder",
    folderChoose: "Choose…",
    deviceLabel: "Device name",
    deviceHint: "Used to name conflict copies, so you can tell which computer made them.",
    launchLabel: "Open Cloud when I sign in",
    testButton: "Test connection",
    saveButton: "Save",
    testing: "Testing…",
    saving: "Saving…",
    saved: "Settings saved.",
    unexpected: "Something unexpected happened. Try again.",
    validation: {
      invalid_input: "Some of the values are not valid.",
      server_required: "Enter the server address.",
      server_invalid: "That is not a valid server address. Use the form https://cloud.example.com.",
      server_insecure: "Use https://. Plain http is only accepted for localhost.",
      email_invalid: "Enter a valid email address.",
      password_required: "Enter the app password.",
      secure_storage_unavailable:
        "This computer cannot encrypt secrets (no system keychain is available), so the app password is not stored.",
      folder_required: "Choose a folder.",
      folder_not_absolute: "Choose a full folder path.",
      folder_unsafe: "Choose a dedicated folder, not your home folder or a drive root.",
      folder_unusable: "The folder could not be created or opened.",
      device_name_required: "Enter a device name.",
      device_name_too_long: "Use at most 64 characters.",
      save_failed: "The settings could not be saved.",
    },
    connection: {
      ok: "Connected as {email}.",
      unauthenticated: "The server did not accept this app password.",
      email_mismatch: "This app password belongs to {email}, not to the email entered.",
      network: "The server could not be reached. Check the address and your connection.",
      server_error: "The server answered with an error. Try again in a moment.",
      bad_response: "That address does not look like a Cloud server.",
    },
  },
};

export type Dictionary = typeof en;
