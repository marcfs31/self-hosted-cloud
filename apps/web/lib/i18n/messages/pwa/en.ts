import type { Widen } from "../../types";
import { isOne } from "../../plural";

export const en = {
  nav: { backup: "Phone backup" },
  install: {
    region: "Install the app",
    text: "Install Cloud on this device to open it like any other app.",
    button: "Install app",
    dismiss: "Not now",
  },
  ios: {
    region: "Install the app",
    text: "To install Cloud on this device, tap the Share button, then choose Add to Home Screen.",
    dismiss: "Got it",
  },
  update: { text: "Update available", reload: "Reload" },
  offline: {
    title: "Cloud can't be reached",
    body: "You seem to be offline, or the server isn't answering. Your files are safe; they show up again as soon as you are connected.",
    retry: "Try again",
  },
  picker: {
    hint: "Open a folder to look inside it, then choose the one you want.",
    target: (folder: string) => `Selected folder: ${folder}`,
    submit: "Use this folder",
  },
  share: {
    title: "Shared with Cloud",
    loading: "Looking for the shared files…",
    unsupported:
      "This browser can't hand shared files over to Cloud. Use Upload in your files instead.",
    empty: {
      title: "Nothing to upload here",
      hint: "Share photos or files to Cloud from another app and they will show up here.",
      back: "Back to files",
    },
    listLabel: "Shared files",
    count: (n: number) =>
      isOne("en", n) ? `${n} file ready to upload` : `${n} files ready to upload`,
    destination: (folder: string) => `Upload to: ${folder}`,
    chooseFolder: "Choose another folder",
    pickerTitle: "Choose where to upload",
    upload: "Upload",
    uploading: "Uploading. Progress is shown in the uploads panel.",
    discard: "Discard",
    discarded: "The shared files were discarded.",
    finished: (n: number, folder: string) =>
      isOne("en", n) ? `Uploaded ${n} file to ${folder}.` : `Uploaded ${n} files to ${folder}.`,
    withFailures: (done: number, failed: number) =>
      `${done} uploaded, ${failed} failed. You can retry the failed ones in the uploads panel.`,
    openFolder: "Open the folder",
  },
  backup: {
    title: "Phone backup",
    intro:
      "Choose the photos and videos on your phone, and Cloud uploads the ones it doesn't have yet. Files already in your cloud are skipped, even if they have a different name.",
    limits:
      "Backup runs while this page is open. Phones don't allow a web app to back up fully automatically in the background, so open this page now and then and choose your new photos.",
    insecure:
      "Phone backup needs a secure (https) connection to check your files. Open Cloud through its https address.",
    destinationDefault: (folder: string) =>
      `Backup folder: ${folder}, created for you if it doesn't exist yet.`,
    destinationChosen: (folder: string) => `Backup folder: ${folder}`,
    chooseFolder: "Choose another folder",
    useDefault: "Use the default folder",
    pickerTitle: "Choose the backup folder",
    choose: "Choose photos and videos",
    take: "Take photo",
    checking: (done: number, total: number) => `Checking ${done} of ${total}…`,
    uploading: (done: number, total: number) => `Uploading: ${done} of ${total} done`,
    summary: (already: number, uploaded: number, failed: number) =>
      `${already} already backed up, ${uploaded} uploaded, ${failed} failed`,
    cancelled: (n: number) => (isOne("en", n) ? `${n} was cancelled.` : `${n} were cancelled.`),
    unchecked: (n: number) =>
      isOne("en", n)
        ? `${n} large file was uploaded without a duplicate check (files over 512 MiB are not checked).`
        : `${n} large files were uploaded without a duplicate check (files over 512 MiB are not checked).`,
    failedHint: "You can retry the failed uploads in the uploads panel.",
  },
};

export type Pwa = Widen<typeof en>;
