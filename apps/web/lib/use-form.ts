"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import type { ErrorCode } from "@cloud/shared";
import { errorCodeOf } from "./api";
import { useT } from "./i18n/provider";

type Field = RefObject<HTMLElement | null> | undefined;

/** A server failure is kept as its code, so it is re-worded if the language changes. */
type RawError = { code: ErrorCode; field: Field } | { text: string; field: Field };

interface FormError {
  text: string;
  field: Field;
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
  const t = useT();
  const [raw, setRaw] = useState<RawError | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const alertId = useId();

  const error = useMemo<FormError | null>(
    () => (raw ? { text: "code" in raw ? t.errors[raw.code] : raw.text, field: raw.field } : null),
    [raw, t],
  );

  useEffect(() => {
    if (raw) {
      (raw.field?.current ?? alertRef.current)?.focus();
    }
  }, [raw]);

  const submit = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setRaw(null);
    try {
      await action();
    } catch (e) {
      setRaw({ code: errorCodeOf(e), field: undefined });
    } finally {
      setBusy(false);
    }
  }, []);

  const fail = useCallback((text: string, field?: RefObject<HTMLElement | null>) => {
    setRaw({ text, field });
  }, []);

  const clear = useCallback(() => {
    setRaw(null);
  }, []);

  return { busy, error, alertId, alertRef, submit, fail, clear };
}
