import type { Metadata } from "next";
import type { ReactNode } from "react";
import { messages } from "../lib/messages";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: messages.app.name, template: `%s · ${messages.app.name}` },
  description: "Your self-hosted cloud",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
