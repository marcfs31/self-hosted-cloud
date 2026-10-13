"use client";

import { useT } from "../../lib/i18n/provider";
import { ActivityList } from "../activity/activity-list";

export function SecurityActivitySection() {
  const t = useT().security.admin;
  return (
    <section aria-labelledby="security-activity-heading" className="stack">
      <h2 id="security-activity-heading">{t.activityTitle}</h2>
      <p className="note">{t.activityIntro}</p>
      <ActivityList path="/admin/activity" caption={t.activityTitle} showAccount />
    </section>
  );
}
