import type { Widen } from "../../types";

export const en = {
  app: {
    name: "Cloud",
    description: "Your self-hosted cloud",
    loading: "Loading…",
    skipToContent: "Skip to content",
    retry: "Try again",
    mainNavLabel: "Main",
  },
  nav: {
    files: "Files",
    admin: "Admin",
    logout: "Log out",
    loggingOut: "Logging out…",
  },
  roles: {
    admin: "Admin",
    member: "Member",
  },
  localeSwitcher: {
    label: "Language",
  },
  home: {
    title: "Files",
    signedInAs: (email: string) => `Signed in as ${email}`,
    comingSoon: "File browsing arrives in the next release.",
  },
  notFound: {
    title: "Page not found",
    body: "This page doesn't exist, or you don't have access to it.",
    home: "Back to files",
  },
};

export type Common = Widen<typeof en>;
