import type { Metadata } from "next";
import { AdminView } from "../../../components/admin/admin-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).admin.title };
}

export default function AdminPage() {
  return <AdminView />;
}
