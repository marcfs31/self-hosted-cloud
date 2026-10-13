import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const ADMIN = { email: "admin@example.test", password: "correct horse battery staple" };
const GIB = 1024 ** 3;
const HOUR_MS = 3600 * 1000;

let origin = "";

test.beforeEach(({ baseURL }) => {
  origin = String(baseURL);
});

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Creates the admin on a fresh server, or just signs in; the browser keeps the session. */
async function signInAsAdmin(page: Page) {
  const headers = { origin };
  const status = await page.request.get("/api/auth/setup");
  const { needsSetup } = (await status.json()) as { needsSetup: boolean };
  const response = needsSetup
    ? await page.request.post("/api/auth/setup", { headers, data: ADMIN })
    : await page.request.post("/api/auth/login", { headers, data: ADMIN });
  expect(response.ok()).toBe(true);
}

async function setLocale(page: Page, locale: string) {
  await page.context().addCookies([{ name: "locale", value: locale, url: origin }]);
}

const isStatusRequest = (url: string) => new URL(url).pathname === "/api/admin/system";

interface Check {
  state: "ok" | "failing" | "stale" | "unknown";
  checkedAt: string | null;
  facts: Record<string, string>;
}

const UNKNOWN: Check = { state: "unknown", checkedAt: null, facts: {} };

/** A full SystemStatus body for tests that need states the empty e2e data dir cannot produce. */
function statusBody(overrides: Record<string, unknown> = {}) {
  return {
    version: "0.6.0",
    uptimeSeconds: 3 * 86400 + 4 * 3600 + 120,
    cpu: { cores: 4, load1: 0.42, load5: 0.35, load15: 0.3, temperatureC: 52.4 },
    memory: { totalBytes: 8 * GIB, availableBytes: 6 * GIB },
    storage: { totalBytes: 500 * GIB, freeBytes: 200 * GIB },
    backup: UNKNOWN,
    restoreTest: UNKNOWN,
    health: UNKNOWN,
    ...overrides,
  };
}

function fulfillWith(body: unknown) {
  return (route: Route) => route.fulfill({ json: body });
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const MIXED = () =>
  statusBody({
    cpu: { cores: 4, load1: 0.42, load5: 0.35, load15: 0.3, temperatureC: null },
    storage: null,
    backup: {
      state: "ok",
      checkedAt: iso(2 * HOUR_MS),
      facts: { repositories: "2", failedRepositories: "0", snapshot: "ok" },
    },
    restoreTest: {
      state: "stale",
      checkedAt: iso(45 * 24 * HOUR_MS),
      facts: { integrity: "ok", files: "12/12" },
    },
    health: {
      state: "failing",
      checkedAt: iso(5 * 60 * 1000),
      facts: {
        endpoint: "503",
        freePercent: "41",
        smart: "FAILED",
        someFutureKey: "a-very-long-value-that-must-wrap-instead-of-forcing-a-sideways-scroll",
      },
    },
  });

test("an admin sees every section, and the host checks are Unknown without reports", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin");
  await page.getByRole("link", { name: "System status" }).click();
  await expect(page).toHaveURL(/\/admin\/system$/);
  await expect(page.getByRole("heading", { name: "System", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/^System · Cloud$/);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "System" }),
  ).toHaveAttribute("aria-current", "page");

  const server = page.getByRole("region", { name: "This server" });
  await expect(server.getByText("Version", { exact: true })).toBeVisible();
  await expect(server.getByText("Running for", { exact: true })).toBeVisible();
  await expect(server.getByText("Processor cores", { exact: true })).toBeVisible();
  await expect(server.getByText(/^\d+([.,]\d+)? \/ \d+([.,]\d+)? \/ \d+([.,]\d+)?$/)).toBeVisible();
  await expect(server.getByText("Temperature", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Memory", level: 2 })).toBeVisible();
  await expect(page.getByRole("meter", { name: "Memory in use" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Storage", level: 2 })).toBeVisible();
  await expect(page.getByRole("meter", { name: "Storage used on /data" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Host checks", level: 2 })).toBeVisible();
  for (const name of ["Backup", "Restore test", "Health"]) {
    const card = page.getByRole("article", { name });
    await expect(card.getByText("Unknown", { exact: true })).toBeVisible();
    await expect(card.getByText("Never reported")).toBeVisible();
    await expect(card.getByText("has never sent a report", { exact: false })).toBeVisible();
  }
  await expectNoViolations(page);
});

test("the header links admins to the dashboard", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "System" })
    .click();
  await expect(page.getByRole("heading", { name: "System", level: 1 })).toBeVisible();
});

test("a member gets the not-found page and no link", async ({ page, browser }) => {
  await signInAsAdmin(page);
  const created = await page.request.post("/api/admin/invites", {
    headers: { origin },
    data: { role: "member", expiresInDays: 1 },
  });
  expect(created.ok()).toBe(true);
  const { token } = (await created.json()) as { token: string };

  const context = await browser.newContext({ baseURL: origin });
  const memberPage = await context.newPage();
  const registered = await context.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      token,
      email: `system-member-${Date.now()}@example.test`,
      password: "another long test passphrase",
    },
  });
  expect(registered.ok()).toBe(true);

  await memberPage.goto("/admin/system");
  await expect(memberPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(memberPage.getByRole("heading", { name: "Host checks" })).toHaveCount(0);
  await expect(memberPage.getByRole("link", { name: "System" })).toHaveCount(0);

  const direct = await context.request.get("/api/admin/system");
  expect(direct.status()).toBe(404);
  await context.close();
});

test("Refresh fetches again and announces it politely", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/system");
  await expect(page.getByRole("meter", { name: "Memory in use" })).toBeVisible();

  await expect(page.locator(".refresh-notice")).toHaveAttribute("aria-live", "polite");
  const refetch = page.waitForResponse((r) => isStatusRequest(r.url()));
  await page.getByRole("button", { name: "Refresh" }).click();
  expect((await refetch).status()).toBe(200);
  await expect(page.locator(".refresh-notice")).toHaveText("Status updated");
  await expect(page.getByText(/^Last updated at /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeFocused();
});

test("a failed refresh keeps the last good data and marks it outdated", async ({ page }) => {
  await signInAsAdmin(page);
  await page.route("**/api/admin/system", fulfillWith(MIXED()));
  await page.goto("/admin/system");
  await expect(page.getByRole("region", { name: "This server" })).toBeVisible();
  await expect(page.getByText("Outdated", { exact: true })).toHaveCount(0);

  await page.unroute("**/api/admin/system");
  await page.route("**/api/admin/system", (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal" } } }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();

  const alert = page.locator('[role="alert"]:not(#__next-route-announcer__)');
  await expect(alert).toContainText("Couldn't refresh the status");
  await expect(page.getByText("Outdated", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "This server" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Health" })).toBeVisible();
  await expect(page.getByText("Status updated")).toHaveCount(0);
  await expectNoViolations(page);

  await page.unroute("**/api/admin/system");
  await page.route("**/api/admin/system", fulfillWith(MIXED()));
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByText("Outdated", { exact: true })).toHaveCount(0);
});

test("with no data at all, a failure is an alert and Refresh recovers", async ({ page }) => {
  await signInAsAdmin(page);
  await page.route("**/api/admin/system", (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal" } } }),
  );
  await page.goto("/admin/system");
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Host checks" })).toHaveCount(0);

  await page.unroute("**/api/admin/system");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { name: "Host checks", level: 2 })).toBeVisible();
});

test("every state shows text and an icon, facts are humanised, and unknown is not healthy", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.route("**/api/admin/system", fulfillWith(MIXED()));
  await page.goto("/admin/system");

  const server = page.getByRole("region", { name: "This server" });
  await expect(server.getByText("3 days, 4 hours")).toBeVisible();
  await expect(server.getByText("0.42 / 0.35 / 0.3")).toBeVisible();
  await expect(server.getByText("Unknown", { exact: true })).toBeVisible();

  await expect(page.getByRole("meter", { name: "Memory in use" })).toHaveAttribute(
    "aria-valuetext",
    "2 GiB of 8 GiB",
  );
  await expect(page.getByText("6 GiB available")).toBeVisible();
  await expect(page.getByText("Unknown. The server couldn't read the disk.")).toBeVisible();
  await expect(page.getByRole("meter", { name: "Storage used on /data" })).toHaveCount(0);

  const backup = page.getByRole("article", { name: "Backup" });
  await expect(backup.getByText("OK", { exact: true })).toBeVisible();
  await expect(backup.getByText(/^Checked 2 hours ago/)).toBeVisible();
  await expect(backup.getByText("Repositories", { exact: true })).toBeVisible();
  await expect(backup.getByText("Failed repositories", { exact: true })).toBeVisible();
  await expect(backup.getByText("Database snapshot", { exact: true })).toBeVisible();

  const restore = page.getByRole("article", { name: "Restore test" });
  await expect(restore.getByText("Stale", { exact: true })).toBeVisible();
  await expect(
    restore.getByText("The host hasn't reported in 45 days", { exact: false }),
  ).toBeVisible();
  await expect(restore.getByText("Files restored / listed", { exact: true })).toBeVisible();

  const health = page.getByRole("article", { name: "Health" });
  await expect(health.getByText("Failing", { exact: true })).toBeVisible();
  await expect(health.getByText("Check the log on the host", { exact: false })).toBeVisible();
  await expect(health.getByText("Free space (%)", { exact: true })).toBeVisible();
  await expect(health.getByText("SMART status", { exact: true })).toBeVisible();
  await expect(health.getByText("FAILED", { exact: true })).toBeVisible();
  await expect(health.getByText("someFutureKey", { exact: true })).toBeVisible();

  for (const card of [backup, restore, health]) {
    await expect(card.locator("svg[aria-hidden='true']")).toHaveCount(1);
  }
  await expectNoViolations(page);
});

test("it refreshes every 30 s while visible and pauses while the tab is hidden", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    window.addEventListener("test-visibility", (event) => {
      hidden = (event as CustomEvent<boolean>).detail;
    });
  });
  await page.clock.install();
  let requests = 0;
  page.on("request", (request) => {
    if (isStatusRequest(request.url())) {
      requests += 1;
    }
  });

  await page.goto("/admin/system");
  await expect(page.getByRole("meter", { name: "Memory in use" })).toBeVisible();
  const afterLoad = requests;
  expect(afterLoad).toBeGreaterThanOrEqual(1);

  await page.clock.fastForward(31_000);
  await expect.poll(() => requests).toBe(afterLoad + 1);
  // Automatic refreshes are silent: no notice.
  await expect(page.getByText("Status updated")).toHaveCount(0);

  const setHidden = (hidden: boolean) =>
    page.evaluate((value) => {
      window.dispatchEvent(new CustomEvent("test-visibility", { detail: value }));
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);

  await setHidden(true);
  await page.clock.fastForward(95_000);
  await page.waitForTimeout(300);
  expect(requests).toBe(afterLoad + 1);

  await setHidden(false);
  await expect.poll(() => requests).toBe(afterLoad + 2);
});

for (const locale of ["en", "it"] as const) {
  test(`the dashboard is accessible in ${locale}`, async ({ page }) => {
    await signInAsAdmin(page);
    await setLocale(page, locale);
    await page.route("**/api/admin/system", fulfillWith(MIXED()));
    await page.goto("/admin/system");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("article")).toHaveCount(3);
    await expectNoViolations(page);
  });
}

test("the Italian dashboard is translated", async ({ page }) => {
  await signInAsAdmin(page);
  await setLocale(page, "it");
  await page.goto("/admin/system");
  await expect(page.getByRole("heading", { name: "Sistema", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Controlli dell'host", level: 2 })).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Backup" }).getByText("Sconosciuto", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/^Sistema · Cloud$/);
});

test("it fits a 320 px screen without sideways scrolling", async ({ page }) => {
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.route("**/api/admin/system", fulfillWith(MIXED()));
  await page.goto("/admin/system");
  await expect(page.getByRole("article")).toHaveCount(3);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoViolations(page);
});
