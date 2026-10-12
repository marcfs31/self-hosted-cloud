import type { Metadata } from "next";
import { Home } from "../../components/home";
import { messages } from "../../lib/messages";

export const metadata: Metadata = { title: messages.home.title };

export default function HomePage() {
  return <Home />;
}
