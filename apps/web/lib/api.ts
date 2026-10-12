import type { ErrorCode } from "@cloud/shared";
import { messages } from "./messages";

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
  return typeof value === "string" && Object.hasOwn(messages.errors, value);
}

function codeFromBody(body: unknown): ErrorCode {
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
 * The only function in the web app that calls fetch. `path` is relative to /api,
 * for example "/auth/me". Resolves with the parsed JSON body (undefined for 204).
 */
export async function apiFetch<T = void>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const requestHeaders = new Headers(headers);
  let body: string | undefined;
  if (json !== undefined) {
    requestHeaders.set("content-type", "application/json");
    body = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...rest,
      headers: requestHeaders,
      credentials: "same-origin",
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    throw new ApiError("internal", 0);
  }

  if (!res.ok) {
    throw new ApiError(codeFromBody(await readJson(res)), res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const parsed = await readJson(res);
  if (parsed === undefined) {
    throw new ApiError("internal", res.status);
  }
  return parsed as T;
}

/** Copy for any thrown value. Unknown failures read as an internal error. */
export function errorMessage(error: unknown): string {
  return messages.errors[error instanceof ApiError ? error.code : "internal"];
}
