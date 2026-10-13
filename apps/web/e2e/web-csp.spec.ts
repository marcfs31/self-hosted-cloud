import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// The browser enforces the policy, so this drives real pages and fails on any report.
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.test", password: "correct horse battery staple" };
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

let context: BrowserContext;
let origin = "";
const ids: Record<string, string> = {};

function b64(text: string): string {
  return Buffer.from(text).toString("base64");
}

async function upload(parentId: string, name: string, content: Buffer, mime: string) {
  const created = await context.request.post("/api/uploads", {
    headers: {
      origin,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(content.length),
      "Upload-Metadata": `filename ${b64(name)},parentId ${b64(parentId)},filetype ${b64(mime)}`,
    },
  });
  expect(created.status()).toBe(201);
  const location = new URL(created.headers()["location"] ?? "", origin).pathname;
  const done = await context.request.patch(location, {
    headers: {
      origin,
      "Tus-Resumable": "1.0.0",
      "Content-Type": "application/offset+octet-stream",
      "Upload-Offset": "0",
    },
    data: content,
  });
  expect(done.status()).toBe(204);
  return done.headers()["cloud-file-id"] ?? "";
}

test.beforeAll(async ({ browser }, testInfo) => {
  origin = String(testInfo.project.use.baseURL);
  context = await browser.newContext({ baseURL: origin });
  const setup = await context.request.get("/api/auth/setup");
  const { needsSetup } = (await setup.json()) as { needsSetup: boolean };
  const response = await context.request.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", {
    headers: { origin },
    data: ADMIN,
  });
  expect(response.ok()).toBe(true);

  const root = await context.request.get("/api/files/root");
  const rootId = ((await root.json()) as { folder: { id: string } }).folder.id;
  ids["pixel"] = await upload(rootId, "csp-pixel.png", PIXEL, "image/png");
  ids["pdf"] = await upload(rootId, "csp-paper.pdf", PDF, "application/pdf");
  ids["text"] = await upload(rootId, "csp-notes.txt", Buffer.from("hello"), "text/plain");
});

test.afterAll(async () => {
  await context.close();
});

/** Collects every CSP report and console complaint a page produces from now on. */
async function watch(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to/i.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => problems.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(
        `Content Security Policy report: ${event.violatedDirective} blocked ${event.blockedURI}`,
      );
    });
  });
  return problems;
}

function directive(policy: string, name: string): string[] {
  const part = policy.split(";").find((entry) => entry.trim().startsWith(`${name} `));
  return part?.trim().split(" ").slice(1) ?? [];
}

test("every page response carries a strict nonce policy and the other security headers", async () => {
  for (const path of ["/login", "/", "/offline"]) {
    const response = await context.request.get(path, { maxRedirects: 0 });
    const policy = response.headers()["content-security-policy"] ?? "";
    expect(policy, path).not.toBe("");
    expect(directive(policy, "default-src"), path).toEqual(["'self'"]);
    expect(directive(policy, "script-src"), path).toEqual(
      expect.arrayContaining(["'self'", "'strict-dynamic'"]),
    );
    expect(directive(policy, "script-src").some((s) => /^'nonce-[A-Za-z0-9+/=]+'$/.test(s))).toBe(
      true,
    );
    expect(directive(policy, "script-src")).not.toContain("'unsafe-inline'");
    for (const [name, value] of [
      ["frame-ancestors", "'none'"],
      ["base-uri", "'none'"],
      ["object-src", "'none'"],
      ["form-action", "'self'"],
      ["connect-src", "'self'"],
      ["frame-src", "'self'"],
      ["worker-src", "'self'"],
      ["manifest-src", "'self'"],
    ] as const) {
      expect(directive(policy, name), `${path} ${name}`).toEqual([value]);
    }
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["permissions-policy"]).toContain("camera=()");
  }
});

test("the nonce is new for every response", async () => {
  const nonces = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    const response = await context.request.get("/login");
    const policy = response.headers()["content-security-policy"] ?? "";
    nonces.add(/'nonce-([^']+)'/.exec(policy)?.[1] ?? "");
  }
  expect(nonces.size).toBe(3);
  expect(nonces.has("")).toBe(false);
});

test("the API keeps its own headers: no page policy on file content, sandbox kept off PDFs only", async () => {
  const image = await context.request.get(`/api/files/${ids["pixel"]}/content`);
  expect(image.headers()["content-security-policy"]).toContain("sandbox");
  const pdf = await context.request.get(`/api/files/${ids["pdf"]}/content`);
  expect(pdf.headers()["content-security-policy"]).toBe(
    "default-src 'none'; frame-ancestors 'self'",
  );
  expect(pdf.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the signed-out pages run without a single policy violation", async ({ browser }) => {
  const page = await (await browser.newContext({ baseURL: origin })).newPage();
  const problems = await watch(page);
  for (const path of ["/login", "/offline"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(problems).toEqual([]);
  await page.context().close();
});

test("the signed-in pages run without a single policy violation", async () => {
  const page = await context.newPage();
  const problems = await watch(page);
  for (const path of [
    "/",
    "/photos",
    "/albums",
    "/shares",
    "/trash",
    "/backup",
    "/search?q=csp",
    "/activity",
    "/settings",
    "/admin",
    "/admin/system",
    "/share-target",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main, #main").first(), path).toBeVisible();
  }
  expect(problems).toEqual([]);
  await page.close();
});

test("previews and a public share link run without a policy violation", async ({ browser }) => {
  const page = await context.newPage();
  const problems = await watch(page);
  await page.goto("/");
  for (const name of ["csp-pixel.png", "csp-paper.pdf", "csp-notes.txt"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog", { name });
    await expect(dialog).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }

  const created = await context.request.post("/api/shares", {
    headers: { origin },
    data: { fileId: ids["pixel"] },
  });
  expect(created.status()).toBe(201);
  const { token } = (await created.json()) as { token: string };
  const stranger = await browser.newContext({ baseURL: origin });
  const sharePage = await stranger.newPage();
  const shareProblems = await watch(sharePage);
  await sharePage.goto(`/s/${token}`);
  await sharePage.waitForLoadState("networkidle");
  await expect(sharePage.locator("img").first()).toBeVisible();
  expect(shareProblems).toEqual([]);
  await stranger.close();

  expect(problems).toEqual([]);
  await page.close();
});
