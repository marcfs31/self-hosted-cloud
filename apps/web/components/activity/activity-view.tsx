"use client";

import Link from "next/link";
import { useT } from "../../lib/i18n/provider";
import { ActivityList } from "./activity-list";

export function ActivityView() {
  const t = useT().activity;
  return (
    <>
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      <p>
        <Link href="/settings">{t.settingsLink}</Link>
      </p>
      <ActivityList path="/activity" caption={t.caption} showAccount={false} />
    </>
  );
}
