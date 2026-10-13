"use client";

import Link from "next/link";
import { useT } from "../../lib/i18n/provider";
import { useSession } from "../../lib/session";
import { NotFoundState } from "../not-found-state";
import { InvitesSection } from "./invites-section";
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
      <p>
        <Link href="/admin/system">{t.system.adminLink}</Link>
        <span className="note"> · {t.system.adminLinkNote}</span>
      </p>
      <UsersSection me={user} />
      <InvitesSection />
    </>
  );
}
