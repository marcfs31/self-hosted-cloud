import type { Metadata } from "next";
import { ShareTargetView } from "../../../components/share/share-target-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).pwa.share.title };
}

export default async function ShareTargetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await searchParams;
  return <ShareTargetView shareId={typeof id === "string" ? id : null} />;
}
