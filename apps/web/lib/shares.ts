/** Pure rules of the sharing UI; the calls live in shares-api.ts. */

export const EXPIRY_CHOICES = ["1", "7", "30", "365", "never"] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

export const DEFAULT_EXPIRY: ExpiryChoice = "7";

/** Matches the API: a password shorter than this is refused. */
export const MIN_PASSWORD_LENGTH = 8;

export function isExpiryChoice(value: string): value is ExpiryChoice {
  return (EXPIRY_CHOICES as readonly string[]).includes(value);
}

/** The API's `expiresInDays`: a whole number of days, or null for a link that never expires. */
export function expiryDays(choice: ExpiryChoice): number | null {
  return choice === "never" ? null : Number(choice);
}

/** The address people open; the raw token is only ever shown to the owner once. */
export function shareLink(origin: string, token: string): string {
  return `${origin}/s/${encodeURIComponent(token)}`;
}

/** An empty password means "no password"; anything else must be long enough. */
export function passwordProblem(password: string): "tooShort" | null {
  return password !== "" && password.length < MIN_PASSWORD_LENGTH ? "tooShort" : null;
}

export function isExpired(expiresAt: string | null, now: number): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= now;
}

export type PreviewKind = "image" | "video" | "audio";

const PREVIEWABLE: Record<string, PreviewKind> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/avif": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
};

/**
 * What the browser can show inline. The API serves only these types inline and everything else
 * as an attachment, so anything not listed has no preview (an SVG would be a download, not an image).
 */
export function previewKind(mime: string | null): PreviewKind | null {
  return mime === null ? null : (PREVIEWABLE[mime] ?? null);
}
