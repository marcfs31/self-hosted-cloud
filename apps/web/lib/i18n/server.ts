import { cookies, headers } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

/** The request's locale: the `locale` cookie, then Accept-Language, then English. */
export const getLocale = cache(async (): Promise<Locale> => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get("accept-language"));
});

/** Copy for server components (layouts, pages, metadata). Client components use useT(). */
export async function getT(): Promise<Messages> {
  return MESSAGES[await getLocale()];
}
