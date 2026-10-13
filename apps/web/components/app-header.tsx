"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ErrorCode } from "@cloud/shared";
import { errorCodeOf } from "../lib/api";
import { useT } from "../lib/i18n/provider";
import { useSession } from "../lib/session";
import { LocaleSwitcher } from "./locale-switcher";

function NavLink({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {label}
    </Link>
  );
}

export function AppHeader() {
  const t = useT();
  const { user, logout } = useSession();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);

  async function onLogout() {
    setBusy(true);
    setError(null);
    try {
      await logout();
    } catch (e) {
      setError(errorCodeOf(e));
      setBusy(false);
    }
  }

  return (
    <header className="app-header">
      <a href="#main" className="skip-link">
        {t.common.app.skipToContent}
      </a>
      <div className="container header-inner">
        <span className="brand">{t.common.app.name}</span>
        <nav aria-label={t.common.app.mainNavLabel}>
          <ul className="nav-list">
            <li>
              <NavLink
                href="/"
                label={t.common.nav.files}
                current={pathname === "/" || pathname.startsWith("/folders/")}
              />
            </li>
            <li>
              <NavLink href="/trash" label={t.common.nav.trash} current={pathname === "/trash"} />
            </li>
            <li>
              <NavLink href="/backup" label={t.pwa.nav.backup} current={pathname === "/backup"} />
            </li>
            {user.role === "admin" ? (
              <li>
                <NavLink href="/admin" label={t.common.nav.admin} current={pathname === "/admin"} />
              </li>
            ) : null}
          </ul>
        </nav>
        <div className="header-user">
          <LocaleSwitcher />
          <span className="user-email">{user.email}</span>
          <button
            type="button"
            className="button button-quiet"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void onLogout();
            }}
          >
            {busy ? t.common.nav.loggingOut : t.common.nav.logout}
          </button>
        </div>
      </div>
      {error ? (
        <div className="container">
          <p role="alert" className="alert">
            {t.errors[error]}
          </p>
        </div>
      ) : null}
    </header>
  );
}
