"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { errorMessage } from "./api";

interface FormError {
  text: string;
  field: RefObject<HTMLElement | null> | undefined;
}

export interface FormState {
  busy: boolean;
  error: FormError | null;
  alertId: string;
  alertRef: RefObject<HTMLDivElement | null>;
  /** Runs an async action with busy tracking; a thrown error becomes the form alert. */
  submit: (action: () => Promise<void>) => Promise<void>;
  /** Shows a client-side validation error and moves focus to the offending field. */
  fail: (text: string, field?: RefObject<HTMLElement | null>) => void;
  clear: () => void;
}

/**
 * Shared submit behaviour: busy flag, one error alert, focus moved to the first
 * invalid field (client errors) or to the alert (server errors).
 */
export function useForm(): FormState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const alertId = useId();

  useEffect(() => {
    if (error) {
      (error.field?.current ?? alertRef.current)?.focus();
    }
  }, [error]);

  const submit = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError({ text: errorMessage(e), field: undefined });
    } finally {
      setBusy(false);
    }
  }, []);

  const fail = useCallback((text: string, field?: RefObject<HTMLElement | null>) => {
    setError({ text, field });
  }, []);

  const clear = useCallback(() => {
    setError(null);
  }, []);

  return { busy, error, alertId, alertRef, submit, fail, clear };
}
