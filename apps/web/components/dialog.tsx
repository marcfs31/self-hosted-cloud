"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface DialogProps {
  title: string;
  /** Called when the dialog is dismissed with Escape. Close buttons call the parent directly. */
  onClose: () => void;
  /**
   * Gets the focus back when the dialog goes away; the page's main area otherwise. A function
   * is called at that moment, for a target that changes while the dialog is open.
   */
  returnFocus?: HTMLElement | (() => HTMLElement | null) | null;
  /** Extra class on the <dialog>, for a variant such as the full-screen preview. */
  className?: string;
  children: ReactNode;
}

/**
 * A modal built on the native <dialog>: the browser makes the rest of the page inert, traps
 * focus and closes on Escape. Mount it to open it and unmount it to close it.
 */
export function Dialog({ title, onClose, returnFocus, className, children }: DialogProps) {
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
    return () => {
      const target = typeof returnTo.current === "function" ? returnTo.current() : returnTo.current;
      const back = target?.isConnected ? target : document.getElementById("main");
      back?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={className ? `dialog ${className}` : "dialog"}
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
