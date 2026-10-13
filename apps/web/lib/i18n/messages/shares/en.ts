import type { Widen } from "../../types";

export const en = {
  title: "Shared links",
  menuShare: "Share…",
  loading: "Loading your shared links…",
  caption: "Your shared links",
  intro:
    "Anyone who has one of these links can open what it shares. A link is shown only once, when you create it.",
  columns: {
    item: "Item",
    kind: "Type",
    dropBox: "Drop box",
    password: "Password",
    created: "Created",
    expires: "Expires",
    actions: "Actions",
  },
  kind: {
    file: "File",
    folder: "Folder",
  },
  yes: "Yes",
  no: "No",
  never: "Never",
  expired: (date: string) => `${date} (expired)`,
  empty: {
    title: "You haven't shared anything yet",
    hint: "Choose Share… in the menu of a file or folder to create a link.",
  },
  revoke: "Revoke",
  revokeLabel: (name: string) => `Revoke the link to ${name}`,
  confirm: {
    title: "Revoke this link?",
    body: (name: string) =>
      `Anyone who has the link to ${name} will lose access straight away. This can't be undone.`,
    cancel: "Cancel",
    submit: "Revoke link",
    submitting: "Revoking…",
  },
  notices: {
    revoked: (name: string) => `Revoked the link to ${name}`,
  },
  password: {
    show: "Show password",
    hide: "Hide password",
  },
  share: {
    title: (name: string) => `Share ${name}`,
    expiryLabel: "Link expires",
    expiry: {
      "1": "After 1 day",
      "7": "After 7 days",
      "30": "After 30 days",
      "365": "After 1 year",
      never: "Never",
    },
    passwordLabel: "Password (optional)",
    passwordHint: "At least 8 characters. Send it separately from the link.",
    passwordTooShort: "Use at least 8 characters, or leave the password empty.",
    dropBox: "Let people upload files (drop box — they can't see the folder's contents)",
    submit: "Create link",
    submitting: "Creating…",
    cancel: "Cancel",
    created: {
      title: "Your link is ready",
      linkLabel: "Link",
      copy: "Copy link",
      copied: "Link copied.",
      copyFailed: "Couldn't copy it automatically. Select the link and copy it yourself.",
      once: "This is the only time the link is shown. Copy it now; if you lose it, create a new one.",
      expires: (date: string) => `It works until ${date}.`,
      neverExpires: "It works until you revoke it.",
      protected: "People will need the password to open it.",
      manage: "You can revoke it at any time on the Shared links page.",
      done: "Done",
    },
  },
  public: {
    pageTitle: "Shared link",
    loading: "Opening the link…",
    expiresOn: (date: string) => `This link works until ${date}.`,
    notFound: {
      title: "This link doesn't work",
      body: "It may have expired, been removed by its owner, or been mistyped. Ask the person who sent it for a new link.",
    },
    locked: {
      title: "This link is protected",
      body: "Enter the password you were given to open it.",
      label: "Password",
      submit: "Open",
      submitting: "Checking…",
      wrong: "That password isn't right. Please try again.",
    },
    file: {
      size: (size: string) => `Size: ${size}`,
      download: "Download",
    },
    folder: {
      caption: (folder: string) => `Contents of ${folder}`,
      empty: "There is nothing in this folder.",
      download: "Download",
      downloadLabel: (name: string) => `Download ${name}`,
      downloadAll: "Download all (.zip)",
    },
    dropbox: {
      title: (name: string) => `Send files to ${name}`,
      intro:
        "Your files go straight into the folder. You won't see what's inside it, and neither will anyone else with this link.",
      choose: "Choose files",
      dropHint: "or drop files here",
      dropActive: "Drop the files to send them",
      full: "These files don't fit: the owner's storage is full.",
      gone: "This drop box has been closed. Ask the person who shared it for a new link.",
    },
  },
};

export type Shares = Widen<typeof en>;
