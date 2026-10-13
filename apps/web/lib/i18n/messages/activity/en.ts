import type { Widen } from "../../types";
import { isOne } from "../../plural";

export const en = {
  title: "Activity",
  intro: "What has happened on your account, newest first.",
  settingsLink: "Security settings",
  loading: "Loading activity…",
  empty: "Nothing to show yet.",
  caption: "Activity",
  colEvent: "Event",
  colAccount: "Account",
  colWhen: "When",
  colIp: "IP address",
  colDetails: "Details",
  noIp: "Not recorded",
  loadMore: "Load more",
  loadingMore: "Loading…",
  loadedMore: (n: number) =>
    isOne("en", n) ? `${n} more event loaded.` : `${n} more events loaded.`,
  end: "That's everything.",
  events: {
    login_succeeded: "Signed in",
    login_failed: "Failed sign-in attempt",
    logout: "Signed out",
    passkey_added: "Passkey added",
    passkey_removed: "Passkey removed",
    totp_enabled: "Two-step verification turned on",
    totp_disabled: "Two-step verification turned off",
    mfa_reset_by_admin: "Two-step verification reset by an admin",
    app_password_created: "App password created",
    app_password_revoked: "App password revoked",
    upload: "File uploaded",
    trash: "Moved to the trash",
    restore: "Restored from the trash",
    purge: "Deleted for good",
    share_created: "Share link created",
    share_revoked: "Share link revoked",
  },
  methods: {
    password: "Password",
    totp: "Authenticator code",
    recovery_code: "Recovery code",
    passkey: "Passkey",
  },
  detail: {
    method: (method: string) => `Method: ${method}`,
    file: (name: string) => `File: ${name}`,
    passkey: (name: string) => `Passkey: ${name}`,
    appPassword: (name: string) => `App password: ${name}`,
    by: (email: string) => `Done by ${email}`,
  },
};

export type Activity = Widen<typeof en>;
