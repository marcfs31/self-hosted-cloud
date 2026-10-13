"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface MenuItem {
  key: string;
  label: string;
  /** A link item navigates; an action item calls onSelect. */
  href?: string;
  download?: boolean;
  onSelect?: (trigger: HTMLButtonElement) => void;
}

interface RowMenuProps {
  /** The accessible name of the menu button, for example "Actions for report.pdf". */
  label: string;
  items: readonly MenuItem[];
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <circle cx="12" cy="5" r="1.75" fill="currentColor" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <circle cx="12" cy="19" r="1.75" fill="currentColor" />
    </svg>
  );
}

/** The ARIA menu-button pattern: arrow keys move, Escape closes, Tab leaves. */
export function RowMenu({ label, items }: RowMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState<"first" | "last">("first");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  function entries(): HTMLElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const list = entries();
    (first === "last" ? list.at(-1) : list[0])?.focus();
  }, [open, first]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function openAt(where: "first" | "last") {
    setFirst(where);
    setOpen(true);
  }

  // Removing the link while its click is still being handled would cancel the navigation or
  // download it starts, so the menu closes once the click is done.
  function closeAfterLink() {
    setTimeout(() => {
      setOpen(false);
    }, 0);
  }

  function closeAndFocusButton() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAt("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt("last");
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const list = entries();
    const at = list.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = list[(at + 1) % list.length];
        break;
      case "ArrowUp":
        next = list[(at - 1 + list.length) % list.length];
        break;
      case "Home":
        next = list[0];
        break;
      case "End":
        next = list.at(-1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeAndFocusButton();
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  }

  return (
    <div
      className="row-menu"
      ref={rootRef}
      onBlur={(event) => {
        if (open && !rootRef.current?.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="button button-quiet button-icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openAt("first");
          }
        }}
        onKeyDown={onButtonKeyDown}
      >
        <MenuIcon />
      </button>
      {open ? (
        <ul
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="menu"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <li key={item.key} role="none">
              {item.href !== undefined ? (
                item.download ? (
                  <a
                    role="menuitem"
                    tabIndex={-1}
                    className="menu-item"
                    href={item.href}
                    download=""
                    onClick={closeAfterLink}
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link
                    role="menuitem"
                    tabIndex={-1}
                    className="menu-item"
                    href={item.href}
                    onClick={closeAfterLink}
                  >
                    {item.label}
                  </Link>
                )
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="menu-item"
                  onClick={() => {
                    setOpen(false);
                    if (buttonRef.current) {
                      item.onSelect?.(buttonRef.current);
                    }
                  }}
                >
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
