import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaBar } from "../components/pwa/pwa-bar";
import { I18nProvider } from "../lib/i18n/provider";
import { getLocale, getT } from "../lib/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { app } = (await getT()).common;
  return {
    title: { default: app.name, template: `%s · ${app.name}` },
    description: app.description,
    icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
    appleWebApp: { capable: true, title: app.name, statusBarStyle: "default" },
  };
}

// The same colours as --color-bg in globals.css, light and dark.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121418" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
          {children}
          <PwaBar />
        </I18nProvider>
      </body>
    </html>
  );
}
