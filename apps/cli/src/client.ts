import { errorResponse } from "@cloud/shared";
import { CliError, EXIT, apiError } from "./errors.js";

export interface Parser<T> {
  parse(input: unknown): T;
}

const REQUEST_TIMEOUT_MS = 30_000;

function describeFailure(cause: unknown): string {
  if (!(cause instanceof Error)) return "unknown error";
  const inner = cause.cause;
  if (inner instanceof Error) {
    return inner.message || (inner as NodeJS.ErrnoException).code || cause.message;
  }
  return cause.message;
}

/** The only place that calls fetch. Every request carries the app password as a Bearer token. */
export class ApiClient {
  constructor(
    /** Origin of the server, e.g. https://cloud.example.com */
    readonly server: string,
    private readonly token: string,
  ) {}

  get authorization(): string {
    return `Bearer ${this.token}`;
  }

  url(path: string): string {
    return new URL(path, this.server).toString();
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    timeout: boolean,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: this.authorization,
      Accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    if (timeout) init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(this.url(path), init);
    } catch (cause) {
      throw new CliError(
        `Could not reach ${this.server}: ${describeFailure(cause)}`,
        EXIT.other,
        "network",
      );
    }
    if (!res.ok) throw await failureOf(res);
    return res;
  }

  async json<T>(method: string, path: string, parser: Parser<T>, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body, true);
    let data: unknown;
    try {
      data = await res.json();
      return parser.parse(data);
    } catch {
      throw new CliError(
        "The server sent a response this version of cloud does not understand.",
        EXIT.other,
        "bad_response",
      );
    }
  }

  async noContent(method: string, path: string, body?: unknown): Promise<void> {
    const res = await this.send(method, path, body, true);
    await res.body?.cancel();
  }

  /** A streamed response with no timeout; the caller consumes the body. */
  stream(path: string): Promise<Response> {
    return this.send("GET", path, undefined, false);
  }
}

export async function failureOf(res: Response): Promise<CliError> {
  let code;
  try {
    const parsed = errorResponse.safeParse(JSON.parse(await res.text()));
    if (parsed.success) code = parsed.data.error.code;
  } catch {
    // not a JSON error body: fall back to the HTTP status
  }
  return apiError(res.status, code);
}
