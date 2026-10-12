"use client";

import { messages } from "../../lib/messages";
import { useSession } from "../../lib/session";
import { NotFoundState } from "../not-found-state";
import { InvitesSection } from "./invites-section";
import { UsersSection } from "./users-section";

export function AdminView() {
  const { user } = useSession();
  if (user.role !== "admin") {
    return <NotFoundState />;
  }
  return (
    <>
      <h1>{messages.admin.title}</h1>
      <UsersSection me={user} />
      <InvitesSection />
    </>
  );
}
