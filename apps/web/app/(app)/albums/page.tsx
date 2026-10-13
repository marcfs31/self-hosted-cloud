import type { Metadata } from "next";
import { AlbumsView } from "../../../components/photos/albums-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).photos.albums.title };
}

export default function AlbumsPage() {
  return <AlbumsView />;
}
