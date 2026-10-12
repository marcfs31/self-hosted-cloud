import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, errorMessage } from "./api";
import { messages } from "./messages";

function mockFetch(response: Response | Error) {
  const fn = vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ApiError) {
      return e;
    }
    throw e;
  }
  throw new Error("expected apiFetch to reject");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns the parsed JSON body of a 2xx response", async () => {
    const fetchMock = mockFetch(json({ needsSetup: true }, 200));
    await expect(apiFetch<{ needsSetup: boolean }>("/auth/setup")).resolves.toEqual({
      needsSetup: true,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/setup");
    expect(init?.credentials).toBe("same-origin");
  });

  it("sends the json option as a JSON body with a content type", async () => {
    const fetchMock = mockFetch(json({ ok: 1 }, 200));
    await apiFetch("/auth/login", { method: "POST", json: { email: "a@b.test" } });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"email":"a@b.test"}');
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("sends no body or content type when json is omitted", async () => {
    const fetchMock = mockFetch(json({}, 200));
    await apiFetch("/auth/me");
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
  });

  it("resolves undefined for 204", async () => {
    mockFetch(new Response(null, { status: 204 }));
    await expect(apiFetch("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("throws ApiError with the code and status from the error body", async () => {
    mockFetch(json({ error: { code: "invalid_credentials" } }, 401));
    const error = await failure(apiFetch("/auth/login", { method: "POST", json: {} }));
    expect(error.code).toBe("invalid_credentials");
    expect(error.status).toBe(401);
  });

  it.each([
    ["an unknown code", json({ error: { code: "teapot" } }, 418)],
    ["a body without an error", json({ hello: "world" }, 500)],
    ["a non-object error", json({ error: "boom" }, 500)],
    ["a non-JSON body", new Response("<html>bad gateway</html>", { status: 502 })],
    ["an empty body", new Response(null, { status: 503 })],
  ])("maps %s to the internal code", async (_name, response) => {
    mockFetch(response);
    const error = await failure(apiFetch("/auth/me"));
    expect(error.code).toBe("internal");
    expect(error.status).toBe(response.status);
  });

  it("maps a network failure to internal with status 0", async () => {
    mockFetch(new TypeError("Failed to fetch"));
    const error = await failure(apiFetch("/auth/me"));
    expect(error.code).toBe("internal");
    expect(error.status).toBe(0);
  });

  it("treats a 2xx response with an unreadable body as internal", async () => {
    mockFetch(new Response("not json", { status: 200 }));
    const error = await failure(apiFetch("/auth/me"));
    expect(error.code).toBe("internal");
  });
});

describe("errorMessage", () => {
  it("returns the copy for the error code", () => {
    expect(errorMessage(new ApiError("email_taken", 409))).toBe(messages.errors.email_taken);
  });

  it("falls back to the internal copy for unknown failures", () => {
    expect(errorMessage(new Error("x"))).toBe(messages.errors.internal);
    expect(errorMessage("x")).toBe(messages.errors.internal);
  });
});
