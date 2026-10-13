"use client";

import { useT } from "../../lib/i18n/provider";

/** Unknown, revoked and expired links all look the same: nothing says which one it was. */
export function NotFound() {
  const t = useT().shares.public.notFound;
  return (
    <>
      <h1>{t.title}</h1>
      <p>{t.body}</p>
    </>
  );
}
