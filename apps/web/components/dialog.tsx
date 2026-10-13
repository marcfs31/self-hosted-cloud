"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface DialogProps {
  title: string;
  /** Called when the dialog is dismissed with Escape. Close buttons call the parent directly. */
  onClose: () => void;
  /**
   * Gets the focus back when the dialog goes away; the page's main area otherwise. A function
   * is asked when the dialog closes, for a target that changes while it is open.
   */
  returnFocus?: HTMLElement | null | (() => HTMLElement | null);
  /** Nearly the full width, for content like a photo. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * A modal built on the native <dialog>: the browser makes the rest of the page inert, traps
 * focus and closes on Escape. Mount it to open it and unmount it to close it.
 */
export function Dialog({ title, onClose, returnFocus, wide = false, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const returnTo = useRef(returnFocus);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const wanted = returnTo.current;
    return () => {
      const target = typeof wanted === "function" ? wanted() : wanted;
      const back = target?.isConnected ? target : document.getElementById("main");
      back?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={wide ? "dialog dialog-wide" : "dialog"}
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <div className="dialog-body stack">
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
