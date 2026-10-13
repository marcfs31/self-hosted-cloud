"use client";

import Link from "next/link";
import { useT } from "../lib/i18n/provider";

export function NotFoundState() {
  const t = useT();
  return (
    <>
      <h1>{t.common.notFound.title}</h1>
      <p>{t.common.notFound.body}</p>
      <p>
        <Link href="/">{t.common.notFound.home}</Link>
      </p>
    </>
  );
}
