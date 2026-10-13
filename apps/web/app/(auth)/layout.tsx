import type { ReactNode } from "react";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { getT } from "../../lib/i18n/server";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getT();
  return (
    <main className="auth">
      <div className="auth-top">
        <p className="brand">{t.common.app.name}</p>
        <LocaleSwitcher />
      </div>
      {children}
    </main>
  );
}
