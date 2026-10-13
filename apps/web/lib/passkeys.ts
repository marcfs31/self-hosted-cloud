/** The DOMException name behind a WebAuthn failure, whether or not the library wrapped it. */
function namesOf(error: unknown): string[] {
  if (typeof error !== "object" || error === null) {
    return [];
  }
  const names: string[] = [];
  if ("name" in error && typeof error.name === "string") {
    names.push(error.name);
  }
  if ("cause" in error) {
    names.push(...namesOf(error.cause));
  }
  return names;
}

/**
 * True when the person dismissed the browser's passkey prompt (or it timed out). Browsers
 * report both as NotAllowedError on purpose, so this is not an error worth showing.
 */
export function isCancellation(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "ERROR_CEREMONY_ABORTED") {
      return true;
    }
  }
  return namesOf(error).some((name) => name === "NotAllowedError" || name === "AbortError");
}

/** True when the authenticator already holds a passkey for this account. */
export function isAlreadyRegistered(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return true;
    }
  }
  return namesOf(error).includes("InvalidStateError");
}
