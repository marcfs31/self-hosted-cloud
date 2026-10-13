"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { useT } from "../lib/i18n/provider";
import { searchHref } from "../lib/search-api";

/** How long typing pauses before the search page updates its results. */
const LIVE_DELAY_MS = 300;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function SearchField() {
  const t = useT().search;
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const onSearchPage = pathname === "/search";
  const urlQuery = onSearchPage ? (params.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQuery);
  // The address-bar query the field already shows, so a back-button change is told apart from
  // the update this field made itself.
  const shown = useRef(urlQuery);

  useEffect(() => {
    if (urlQuery !== shown.current) {
      shown.current = urlQuery;
      setValue(urlQuery);
    }
  }, [urlQuery]);

  // On the search page the results follow what is typed; Next.js picks the new address up.
  useEffect(() => {
    if (!onSearchPage) {
      return;
    }
    const next = value.trim();
    if (next === urlQuery.trim()) {
      return;
    }
    const timer = setTimeout(() => {
      shown.current = next;
      window.history.replaceState(null, "", searchHref(next));
    }, LIVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [value, urlQuery, onSearchPage]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.defaultPrevented || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.altKey || isTyping(event.target) || document.querySelector("dialog[open]")) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    const next = value.trim();
    if (onSearchPage && next === urlQuery.trim()) {
      return;
    }
    router.push(searchHref(next));
  }

  return (
    <form role="search" className="search-box" action="/search" onSubmit={onSubmit}>
      <label htmlFor={id} className="sr-only">
        {t.field.label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        placeholder={t.field.placeholder}
        autoComplete="off"
        maxLength={100}
        enterKeyHint="search"
        aria-keyshortcuts="/"
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <button type="submit" className="button button-quiet button-icon" aria-label={t.field.submit}>
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      </button>
    </form>
  );
}

/** The search field of the app header. `/` focuses it from anywhere except a text field. */
export function SearchBox() {
  return (
    <Suspense fallback={null}>
      <SearchField />
    </Suspense>
  );
}
