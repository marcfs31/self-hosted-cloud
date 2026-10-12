import type { ReactNode } from "react";
import { AppHeader } from "../../components/app-header";
import { SessionProvider } from "../../lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppHeader />
      <main id="main" tabIndex={-1} className="container stack">
        {children}
      </main>
    </SessionProvider>
  );
}
