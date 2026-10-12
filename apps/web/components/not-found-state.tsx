import Link from "next/link";
import { messages } from "../lib/messages";

export function NotFoundState() {
  return (
    <>
      <h1>{messages.notFound.title}</h1>
      <p>{messages.notFound.body}</p>
      <p>
        <Link href="/">{messages.notFound.home}</Link>
      </p>
    </>
  );
}
