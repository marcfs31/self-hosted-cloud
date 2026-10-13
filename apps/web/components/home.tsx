"use client";

import { useT } from "../lib/i18n/provider";
import { useSession } from "../lib/session";

export function Home() {
  const t = useT();
  const { user } = useSession();
  return (
    <>
      <h1>{t.common.home.title}</h1>
      <p>{t.common.home.signedInAs(user.email)}</p>
      <p className="note">{t.common.home.comingSoon}</p>
    </>
  );
}
