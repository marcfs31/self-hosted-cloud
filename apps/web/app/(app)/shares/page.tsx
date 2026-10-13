import type { Metadata } from "next";
import { SharesView } from "../../../components/shares/shares-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).shares.title };
}

export default function SharesPage() {
  return <SharesView />;
}
