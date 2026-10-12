import type { Metadata } from "next";
import { AdminView } from "../../../components/admin/admin-view";
import { messages } from "../../../lib/messages";

export const metadata: Metadata = { title: messages.admin.title };

export default function AdminPage() {
  return <AdminView />;
}
