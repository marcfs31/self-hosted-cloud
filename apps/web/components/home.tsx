"use client";

import { messages } from "../lib/messages";
import { useSession } from "../lib/session";

export function Home() {
  const { user } = useSession();
  return (
    <>
      <h1>{messages.home.title}</h1>
      <p>{messages.home.signedInAs(user.email)}</p>
      <p className="note">{messages.home.comingSoon}</p>
    </>
  );
}
