"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "../lib/api";
import { messages } from "../lib/messages";
import { useSession } from "../lib/session";

function NavLink({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {label}
    </Link>
  );
}

export function AppHeader() {
  const { user, logout } = useSession();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLogout() {
    setBusy(true);
    setError(null);
    try {
      await logout();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <header className="app-header">
      <a href="#main" className="skip-link">
        {messages.app.skipToContent}
      </a>
      <div className="container header-inner">
        <span className="brand">{messages.app.name}</span>
        <nav aria-label={messages.app.mainNavLabel}>
          <ul className="nav-list">
            <li>
              <NavLink href="/" label={messages.nav.files} current={pathname === "/"} />
            </li>
            {user.role === "admin" ? (
              <li>
                <NavLink href="/admin" label={messages.nav.admin} current={pathname === "/admin"} />
              </li>
            ) : null}
          </ul>
        </nav>
        <div className="header-user">
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
            {busy ? messages.nav.loggingOut : messages.nav.logout}
          </button>
        </div>
      </div>
      {error ? (
        <div className="container">
          <p role="alert" className="alert">
            {error}
          </p>
        </div>
      ) : null}
    </header>
  );
}
