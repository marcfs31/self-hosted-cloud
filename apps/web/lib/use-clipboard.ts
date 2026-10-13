"use client";

import { useCallback, useState } from "react";

/** Copies text and keeps a short message about how it went, for a role="status" region. */
export function useClipboard(copiedText: string, failedText: string) {
  const [status, setStatus] = useState("");
  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        setStatus(copiedText);
        return true;
      } catch {
        setStatus(failedText);
        return false;
      }
    },
    [copiedText, failedText],
  );
  return { status, copy };
}
