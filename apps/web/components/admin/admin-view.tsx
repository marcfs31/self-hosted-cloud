"use client";

import { useT } from "../../lib/i18n/provider";
import { useSession } from "../../lib/session";
import { NotFoundState } from "../not-found-state";
import { InvitesSection } from "./invites-section";
import { SecurityActivitySection } from "./security-activity-section";
import { UsersSection } from "./users-section";

export function AdminView() {
  const t = useT();
  const { user } = useSession();
  if (user.role !== "admin") {
    return <NotFoundState />;
  }
  return (
    <>
      <h1>{t.admin.title}</h1>
      <UsersSection me={user} />
      <InvitesSection />
      <SecurityActivitySection />
    </>
  );
}
