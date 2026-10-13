import type { Metadata } from "next";
import { SearchView } from "../../../components/search/search-view";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).search.title };
}

export default function SearchPage() {
  return <SearchView />;
}
