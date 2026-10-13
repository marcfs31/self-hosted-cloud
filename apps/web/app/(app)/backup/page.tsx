import type { Metadata } from "next";
import { BackupView } from "../../../components/backup/backup-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).pwa.backup.title };
}

export default function BackupPage() {
  return <BackupView />;
}
