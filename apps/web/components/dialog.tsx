"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface DialogProps {
  title: string;
  /** Called when the dialog is dismissed with Escape. Close buttons call the parent directly. */
  onClose: () => void;
  /** Gets the focus back when the dialog goes away; the page's main area otherwise. */
  returnFocus?: HTMLElement | null;
  children: ReactNode;
}

/**
 * A modal built on the native <dialog>: the browser makes the rest of the page inert, traps
 * focus and closes on Escape. Mount it to open it and unmount it to close it.
 */
export function Dialog({ title, onClose, returnFocus, children }: DialogProps) {
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
    const target = returnTo.current;
    return () => {
      const back = target?.isConnected ? target : document.getElementById("main");
      back?.focus();
    };
  }, []);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="dialog-body stack">
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
