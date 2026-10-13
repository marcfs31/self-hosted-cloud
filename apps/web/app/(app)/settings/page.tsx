import type { Metadata } from "next";
import { SettingsView } from "../../../components/security/settings-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).security.title };
}

export default function SettingsPage() {
  return <SettingsView />;
}
