import type { Metadata } from "next";
import { getT } from "../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).pwa.offline.title };
}

/** Shown by the service worker when the server cannot be reached. Works without JavaScript. */
export default async function OfflinePage() {
  const t = (await getT()).pwa.offline;
  return (
    <main id="main" className="auth stack">
      <h1>{t.title}</h1>
      <p>{t.body}</p>
      <div>
        <a href="/" className="button">
          {t.retry}
        </a>
      </div>
    </main>
  );
}
