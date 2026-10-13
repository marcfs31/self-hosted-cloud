import type { Metadata } from "next";
import { TrashView } from "../../../components/trash/trash-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).trash.title };
}

export default function TrashPage() {
  return <TrashView />;
}
