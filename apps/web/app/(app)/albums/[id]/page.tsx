import type { Metadata } from "next";
import { AlbumView } from "../../../../components/photos/album-view";
import { getT } from "../../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).photos.albums.title };
}

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AlbumView key={id} albumId={id} />;
}
