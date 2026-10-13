import type { Metadata } from "next";
import { Home } from "../../components/home";
import { getT } from "../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).common.home.title };
}

export default function HomePage() {
  return <Home />;
}
