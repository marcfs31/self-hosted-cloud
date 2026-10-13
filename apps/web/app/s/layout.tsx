import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { getT } from "../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t.shares.public.pageTitle,
    // The token is in the address: keep these pages out of search engines and out of Referer.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/** Public share pages: no session, no signed-in header. Anyone with the link can open them. */
export default async function PublicShareLayout({ children }: { children: ReactNode }) {
  const t = await getT();
  return (
    <>
      <header className="app-header">
        <a href="#main" className="skip-link">
          {t.common.app.skipToContent}
        </a>
        <div className="container header-inner">
          <span className="brand">{t.common.app.name}</span>
          <div className="header-user">
            <LocaleSwitcher />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="container stack">
        {children}
      </main>
    </>
  );
}
