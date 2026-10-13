import type { ReactNode } from "react";
import { AppHeader } from "../../components/app-header";
import { UploadPanel } from "../../components/uploads/upload-panel";
import { UploadsProvider } from "../../components/uploads/uploads-provider";
import { UsageProvider } from "../../components/usage-provider";
import { SessionProvider } from "../../lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <UsageProvider>
        <UploadsProvider>
          <AppHeader />
          <main id="main" tabIndex={-1} className="container stack">
            <UploadPanel />
            {children}
          </main>
        </UploadsProvider>
      </UsageProvider>
    </SessionProvider>
  );
}
