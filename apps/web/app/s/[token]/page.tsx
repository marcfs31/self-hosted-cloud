import { Suspense } from "react";
import { PublicShareView } from "../../../components/public-share/public-share-view";

export default async function PublicSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Suspense fallback={null}>
      <PublicShareView key={token} token={token} />
    </Suspense>
  );
}
