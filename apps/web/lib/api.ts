import type { ErrorCode } from "@cloud/shared";
import { en as englishErrors } from "./i18n/messages/errors/en";

/** Thrown for every non-2xx response, and for network or malformed-response failures. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ApiInit extends Omit<RequestInit, "body"> {
  /** Serialised as the JSON request body. */
  json?: unknown;
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(englishErrors, value);
}

/** The code in an `{ error: { code } }` body; anything else reads as an internal error. */
export function errorCodeFromBody(body: unknown): ErrorCode {
  if (typeof body === "object" && body !== null && "error" in body) {
    const inner = body.error;
    if (typeof inner === "object" && inner !== null && "code" in inner && isErrorCode(inner.code)) {
      return inner.code;
    }
  }
  return "internal";
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * The only place in the web app that calls fetch. `path` is relative to /api. Resolves with
 * the response of a 2xx answer; every other outcome throws an ApiError.
 */
export async function apiFetchResponse(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, credentials: "same-origin" });
  } catch {
    throw new ApiError("internal", 0);
  }
  if (!res.ok) {
    throw new ApiError(errorCodeFromBody(await readJson(res)), res.status);
  }
  return res;
}

/**
 * Calls the API and resolves with the parsed JSON body (undefined for 204). `path` is relative
 * to /api, for example "/auth/me".
 */
export async function apiFetch<T = void>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const requestHeaders = new Headers(headers);
  let body: string | undefined;
  if (json !== undefined) {
    requestHeaders.set("content-type", "application/json");
    body = JSON.stringify(json);
  }

  const res = await apiFetchResponse(path, {
    ...rest,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body }),
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const parsed = await readJson(res);
  if (parsed === undefined) {
    throw new ApiError("internal", res.status);
  }
  return parsed as T;
}

/** The error code for any thrown value. Unknown failures read as an internal error. */
export function errorCodeOf(error: unknown): ErrorCode {
  return error instanceof ApiError ? error.code : "internal";
}

/** Copy for any thrown value, from the current locale's `t.errors`. */
export function errorMessage(error: unknown, errors: Record<ErrorCode, string>): string {
  return errors[errorCodeOf(error)];
}
