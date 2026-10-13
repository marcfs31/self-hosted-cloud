import type { Metadata } from "next";
import { ActivityView } from "../../../components/activity/activity-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).activity.title };
}

export default function ActivityPage() {
  return <ActivityView />;
}
