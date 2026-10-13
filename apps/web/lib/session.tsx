"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ErrorCode, MeResponse, SetupStatusResponse, User } from "@cloud/shared";
import { ApiError, errorCodeOf, apiFetch } from "./api";
import { useT } from "./i18n/provider";

type State =
  { status: "loading" } | { status: "failed"; code: ErrorCode } | { status: "ready"; user: User };

interface Session {
  user: User;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return session;
}

/** Only same-site paths may be used as a post-login destination. */
export function safeNextPath(next: string | null): string {
  if (next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) {
    return next;
  }
  return "/";
}

function loginUrl(): string {
  const here = window.location.pathname + window.location.search;
  return here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const t = useT();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const unmounted = new AbortController();
    const stale = () => unmounted.signal.aborted;
    async function load() {
      try {
        const { user } = await apiFetch<MeResponse>("/auth/me");
        if (!stale()) {
          setState({ status: "ready", user });
        }
      } catch (e) {
        if (stale()) {
          return;
        }
        if (!(e instanceof ApiError && e.status === 401)) {
          setState({ status: "failed", code: errorCodeOf(e) });
          return;
        }
        try {
          const { needsSetup } = await apiFetch<SetupStatusResponse>("/auth/setup");
          if (!stale()) {
            router.replace(needsSetup ? "/setup" : loginUrl());
          }
        } catch (inner) {
          if (!stale()) {
            setState({ status: "failed", code: errorCodeOf(inner) });
          }
        }
      }
    }
    void load();
    return () => {
      unmounted.abort();
    };
  }, [router, attempt]);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (e) {
      // Already logged out elsewhere is the outcome we wanted.
      if (!(e instanceof ApiError && e.status === 401)) {
        throw e;
      }
    }
    router.replace("/login");
  }, [router]);

  const value = useMemo<Session | null>(
    () => (state.status === "ready" ? { user: state.user, logout } : null),
    [state, logout],
  );

  if (value) {
    return <SessionContext value={value}>{children}</SessionContext>;
  }
  if (state.status === "failed") {
    return (
      <main className="container stack">
        <p role="alert" className="alert">
          {t.errors[state.code]}
        </p>
        <button
          type="button"
          className="button"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
        >
          {t.common.app.retry}
        </button>
      </main>
    );
  }
  return (
    <main className="container">
      <p role="status">{t.common.app.loading}</p>
    </main>
  );
}
