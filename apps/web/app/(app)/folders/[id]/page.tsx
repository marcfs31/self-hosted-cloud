import type { Metadata } from "next";
import { FolderView } from "../../../../components/files/folder-view";
import { getT } from "../../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).files.title };
}

export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FolderView key={id} folderId={id} />;
}
