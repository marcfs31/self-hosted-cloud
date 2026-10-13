import { describe, expect, it } from "vitest";
import { isAlreadyRegistered, isCancellation } from "./passkeys";

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

function wrapped(code: string, cause: Error): Error {
  return Object.assign(new Error("wrapped"), { code, cause });
}

describe("isCancellation", () => {
  it("treats a dismissed or timed-out prompt as a cancellation", () => {
    expect(isCancellation(domError("NotAllowedError"))).toBe(true);
    expect(isCancellation(domError("AbortError"))).toBe(true);
  });

  it("sees through the library's wrapper", () => {
    const error = wrapped("ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", domError("NotAllowedError"));
    expect(isCancellation(error)).toBe(true);
    expect(isCancellation(wrapped("ERROR_CEREMONY_ABORTED", domError("AbortError")))).toBe(true);
  });

  it("does not hide real failures", () => {
    expect(isCancellation(domError("SecurityError"))).toBe(false);
    expect(isCancellation(wrapped("ERROR_INVALID_RP_ID", domError("SecurityError")))).toBe(false);
    expect(isCancellation(new TypeError("boom"))).toBe(false);
    expect(isCancellation("NotAllowedError")).toBe(false);
    expect(isCancellation(null)).toBe(false);
  });
});

describe("isAlreadyRegistered", () => {
  it("recognises a duplicate authenticator, wrapped or not", () => {
    expect(isAlreadyRegistered(domError("InvalidStateError"))).toBe(true);
    const error = wrapped(
      "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      domError("InvalidStateError"),
    );
    expect(isAlreadyRegistered(error)).toBe(true);
  });

  it("is false for a cancellation or anything else", () => {
    expect(isAlreadyRegistered(domError("NotAllowedError"))).toBe(false);
    expect(isAlreadyRegistered(undefined)).toBe(false);
  });
});
