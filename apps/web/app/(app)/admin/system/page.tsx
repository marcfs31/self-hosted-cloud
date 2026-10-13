import type { Metadata } from "next";
import { SystemView } from "../../../../components/admin/system-view";
import { getT } from "../../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).system.title };
}

export default function SystemPage() {
  return <SystemView />;
}
