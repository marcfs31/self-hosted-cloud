import type { Metadata } from "next";
import type { ReactNode } from "react";
import { I18nProvider } from "../lib/i18n/provider";
import { getLocale, getT } from "../lib/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { app } = (await getT()).common;
  return {
    title: { default: app.name, template: `%s · ${app.name}` },
    description: app.description,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
