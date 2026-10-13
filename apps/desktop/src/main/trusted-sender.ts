/**
 * An IPC message is served only when it comes from the settings page itself: the frame's URL must
 * be exactly the settings file's URL. Anything else (a stray frame, a navigated page) is refused.
 */
export function isTrustedSender(frameUrl: string | undefined, settingsUrl: string): boolean {
  if (frameUrl === undefined || frameUrl === "") return false;
  try {
    const frame = new URL(frameUrl);
    frame.hash = "";
    frame.search = "";
    return frame.protocol === "file:" && frame.href === settingsUrl;
  } catch {
    return false;
  }
}
