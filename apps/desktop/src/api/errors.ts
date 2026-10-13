import type { ErrorCode } from "@cloud/shared";

/** The server answered, but with a failure. `code` is the API error code when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | undefined,
  ) {
    super(`API error ${status}${code === undefined ? "" : ` ${code}`}`);
    this.name = "ApiError";
  }
}

/** The server could not be reached (DNS, refused, timeout, no network). */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/** The server sent something this version does not understand. */
export class BadResponseError extends Error {
  constructor() {
    super("The server sent a response this version does not understand.");
    this.name = "BadResponseError";
  }
}
