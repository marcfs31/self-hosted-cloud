import type { Metadata } from "next";
import { PhotosView } from "../../../components/photos/photos-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).photos.title };
}

export default function PhotosPage() {
  return <PhotosView />;
}
