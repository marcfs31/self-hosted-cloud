import type { ErrorCode } from "@cloud/shared";

export const EXIT = {
  usage: 1,
  auth: 2,
  notFound: 3,
  conflict: 4,
  quota: 5,
  other: 10,
} as const;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.other,
    readonly code: string = "error",
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function usageError(message: string): CliError {
  return new CliError(message, EXIT.usage, "usage");
}

export function notFoundError(message: string): CliError {
  return new CliError(message, EXIT.notFound, "not_found");
}

export function conflictError(message: string): CliError {
  return new CliError(message, EXIT.conflict, "name_conflict");
}

/** One entry per API error code, so a new code in packages/shared fails the typecheck here. */
const API_ERRORS: Record<ErrorCode, readonly [exit: number, message: string]> = {
  invalid_request: [
    EXIT.usage,
    "The server refused the request as invalid (check names and values).",
  ],
  unauthenticated: [
    EXIT.auth,
    "The server did not accept the app password. Create a new one in Settings > App passwords and run 'cloud login'.",
  ],
  not_found: [EXIT.notFound, "Not found on the server."],
  origin_rejected: [EXIT.other, "The server rejected the request origin."],
  too_many_attempts: [EXIT.other, "Too many attempts. Wait a few minutes and try again."],
  setup_already_done: [EXIT.other, "The server is already set up."],
  invalid_credentials: [EXIT.auth, "The password was not accepted."],
  invite_invalid: [EXIT.other, "The invitation is not valid."],
  email_taken: [EXIT.conflict, "That email address is already in use."],
  cannot_change_self: [EXIT.other, "You cannot change your own account this way."],
  name_conflict: [EXIT.conflict, "An item with that name already exists there."],
  invalid_move: [
    EXIT.conflict,
    "That move is not allowed (an item cannot go into itself, and the root cannot be moved).",
  ],
  quota_exceeded: [EXIT.quota, "Not enough storage space left for this upload."],
  version_is_current: [EXIT.conflict, "The current version cannot be deleted."],
  mfa_required: [EXIT.auth, "A second factor is required for this account."],
  invalid_code: [EXIT.auth, "The verification code was not accepted."],
  thumbnail_unavailable: [EXIT.other, "No thumbnail is available for this item."],
  share_locked: [EXIT.other, "This share is protected by a password."],
  internal: [EXIT.other, "The server had an internal error. Try again later."],
};

function exitForStatus(status: number): number {
  if (status === 401) return EXIT.auth;
  if (status === 404) return EXIT.notFound;
  if (status === 409) return EXIT.conflict;
  if (status === 413) return EXIT.quota;
  return EXIT.other;
}

/** Translate an API failure (its error code when it sent one, else the HTTP status) to plain English. */
export function apiError(status: number, code: ErrorCode | undefined): CliError {
  if (code === undefined) {
    return new CliError(
      `The server answered with an unexpected error (HTTP ${status}).`,
      exitForStatus(status),
      "http_error",
    );
  }
  const [exit, message] = API_ERRORS[code];
  return new CliError(message, exit, code);
}
