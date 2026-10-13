import { createHmac } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

// Passkeys, two-step verification, app passwords and the activity log. Each story uses its own
// member, so nothing here changes the shared admin account except signing in as it. The tests
// run in order and share a few values (the recovery codes, the app password).
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.test", password: "correct horse battery staple" };
const PASSWORD = "a long passphrase for testing";
const TOTP_USER = { email: "totp-user@example.test", password: PASSWORD };
const PASSKEY_USER = { email: "passkey-user@example.test", password: PASSWORD };
const TOKEN_USER = { email: "token-user@example.test", password: PASSWORD };
const LOST_PHONE_USER = { email: "lost-phone@example.test", password: PASSWORD };
const SESSION_USER = { email: "session-user@example.test", password: PASSWORD };
const NEW_PASSWORD = "a different long passphrase";

type Account = { email: string; password: string };

interface Requests {
  request: {
    newContext: (options: {
      baseURL: string;
      extraHTTPHeaders: Record<string, string>;
    }) => Promise<APIRequestContext>;
  };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/[\s=]/g, "").toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238: HMAC-SHA1 over the 30-second step count, dynamically truncated to 6 digits. */
function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac.readUInt8(19) & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** A code for the next step: valid for the server (it accepts one step ahead) and newer than any code used now. */
function nextTotpCode(secret: string): string {
  return totpCode(secret, Date.now() + 30_000);
}

test("the TOTP helper matches the RFC 6238 test vector", () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890", T = 59 s → 94287082 (8 digits).
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  expect(totpCode(secret, 59_000)).toBe("287082");
  expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
});

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

// Next.js adds its own role="alert" route announcer to every page; it is not an error message.
function formAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

async function setLocale(context: BrowserContext, origin: string, locale: "en" | "ca") {
  await context.addCookies([{ name: "locale", value: locale, url: origin }]);
}

const LOGIN_LABELS = {
  en: { email: "Email", password: "Password", submit: "Log in" },
  ca: { email: "Correu electrònic", password: "Contrasenya", submit: "Inicia la sessió" },
} as const;

async function logIn(page: Page, account: Account, locale: "en" | "ca" = "en") {
  const labels = LOGIN_LABELS[locale];
  await page.goto("/login");
  await page.getByLabel(labels.email).fill(account.email);
  await page.getByLabel(labels.password).fill(account.password);
  await page.getByRole("button", { name: labels.submit }).click();
}

async function logOut(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** An API client of its own (no cookies shared with the browser) that sends the Origin header. */
async function apiClient(playwright: Requests, baseURL: string): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
}

async function adminClient(playwright: Requests, baseURL: string): Promise<APIRequestContext> {
  const client = await apiClient(playwright, baseURL);
  const status = await client.get("/api/auth/setup");
  const { needsSetup } = (await status.json()) as { needsSetup: boolean };
  const response = await client.post(needsSetup ? "/api/auth/setup" : "/api/auth/login", {
    data: ADMIN,
  });
  expect(response.ok()).toBe(true);
  return client;
}

/** Creates a member through the invite API, the way the first-run story does through the UI. */
async function createMember(playwright: Requests, baseURL: string, account: Account) {
  const admin = await adminClient(playwright, baseURL);
  const invite = await admin.post("/api/admin/invites", {
    data: { role: "member", expiresInDays: 1 },
  });
  expect(invite.ok()).toBe(true);
  const { token } = (await invite.json()) as { token: string };
  await admin.dispose();
  const anonymous = await apiClient(playwright, baseURL);
  const registered = await anonymous.post("/api/auth/register", {
    data: { token, email: account.email, password: account.password },
  });
  expect(registered.ok()).toBe(true);
  await anonymous.dispose();
}

function section(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/** Reads the secret out of the open setup dialog, without the spaces. */
async function readSecret(dialog: Locator): Promise<string> {
  const grouped = await dialog.getByLabel("Setup key").inputValue();
  expect(grouped).toMatch(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/);
  return grouped.replaceAll(" ", "");
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  for (const account of [TOTP_USER, PASSKEY_USER, TOKEN_USER, SESSION_USER]) {
    await createMember(playwright, baseURL, account);
  }
});

// ---------------------------------------------------------------------------------------------
// Two-step verification
// ---------------------------------------------------------------------------------------------

let secret = "";
let recoveryCodes: string[] = [];

test("settings: set up two-step verification and save the recovery codes", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await logIn(page, TOTP_USER);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Security", level: 1 })).toBeVisible();

  const totp = section(page, "Two-step verification");
  await expect(totp.getByText("Two-step verification is off.")).toBeVisible();
  await totp.getByRole("button", { name: "Set up" }).click();

  const dialog = page.getByRole("dialog", { name: "Set up two-step verification" });
  await expect(dialog).toBeVisible();
  secret = await readSecret(dialog);
  const link = dialog.getByRole("link", { name: "Open in authenticator app" });
  await expect(link).toHaveAttribute("href", /^otpauth:\/\/totp\/.+secret=/);
  await expect(page.locator("canvas, img[alt*='QR' i]")).toHaveCount(0);
  await expectNoViolations(page);

  // A wrong code is explained and keeps the dialog open.
  await dialog.getByLabel("Code from your app").fill("12");
  await dialog.getByRole("button", { name: "Turn on" }).click();
  await expect(formAlert(page)).toHaveText("Enter the 6 digits from your authenticator app.");
  await dialog.getByLabel("Code from your app").fill("000000");
  await dialog.getByRole("button", { name: "Turn on" }).click();
  await expect(formAlert(page)).toHaveText("That code didn't work. Check it and try again.");

  await dialog.getByLabel("Code from your app").fill(totpCode(secret));
  await dialog.getByRole("button", { name: "Turn on" }).click();

  // The ten recovery codes are shown once.
  await expect(dialog).toHaveCount(0);
  const heading = page.getByRole("heading", { name: "Save your recovery codes" });
  await expect(heading).toBeFocused();
  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  recoveryCodes = await list.getByRole("listitem").allTextContents();
  for (const code of recoveryCodes) {
    expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$|^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  }
  expect(new Set(recoveryCodes).size).toBe(10);
  await expect(totp.getByText("Two-step verification is on.").first()).toBeVisible();
  await expect(totp.getByText("You have 10 recovery codes left.")).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole("button", { name: "Copy codes" }).click();
  await expect(page.getByText("Codes copied to the clipboard")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(recoveryCodes.join("\n"));

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("cloud-recovery-codes.txt");
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  for (const code of recoveryCodes) {
    expect(text).toContain(code);
  }

  await page.getByRole("button", { name: "I've saved them" }).click();
  await expect(heading).toHaveCount(0);

  // They are not kept: a reload cannot show them again.
  await page.reload();
  await expect(page.getByText("You have 10 recovery codes left.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Recovery codes" })).toHaveCount(0);

  // The page fits a 320px screen, and stays accessible in Catalan.
  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await setLocale(context, String(baseURL), "ca");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Seguretat", level: 1 })).toBeVisible();
  await expect(page.getByText("Et queden 10 codis de recuperació.")).toBeVisible();
  await expectNoViolations(page);
});

test("login asks for a second step: a wrong code is refused, a right one signs in", async ({
  page,
  context,
  baseURL,
}) => {
  await logIn(page, TOTP_USER);
  const code = page.getByLabel("Authentication code");
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await expect(code).toHaveAttribute("inputmode", "numeric");
  await expect(page.getByText("Enter the 6-digit code from your authenticator app")).toBeVisible();
  await expectNoViolations(page);

  await code.fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(formAlert(page)).toHaveText("That code didn't work. Check it and try again.");
  await expect(formAlert(page)).toBeFocused();
  await expectNoViolations(page);

  // The second step in Catalan has no violations either.
  await setLocale(context, String(baseURL), "ca");
  await logIn(page, TOTP_USER, "ca");
  await expect(page.getByLabel("Codi d'autenticació")).toBeVisible();
  await expectNoViolations(page);
  await setLocale(context, String(baseURL), "en");
  await logIn(page, TOTP_USER);

  // Codes with a space in the middle are accepted, as authenticator apps show them.
  const next = nextTotpCode(secret);
  await page.getByLabel("Authentication code").fill(`${next.slice(0, 3)} ${next.slice(3)}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(TOTP_USER.email)).toBeVisible();

  // A pending session cannot reach the app: the code is required first.
  await logOut(page);
  await logIn(page, TOTP_USER);
  await expect(page.getByLabel("Authentication code")).toBeVisible();
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});

test("login: a recovery code works once", async ({ page }) => {
  const [first, second, third] = recoveryCodes;
  expect(third).toBeDefined();
  await logIn(page, TOTP_USER);
  await page.getByRole("button", { name: "Use a recovery code instead" }).click();
  const field = page.getByLabel("Recovery code");
  await expect(field).toBeFocused();
  await expect(page.getByText("Each code works once.")).toBeVisible();
  await expectNoViolations(page);
  await field.fill(first ?? "");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);
  await logOut(page);

  // The same code a second time is refused.
  await logIn(page, TOTP_USER);
  await page.getByRole("button", { name: "Use a recovery code instead" }).click();
  await page.getByLabel("Recovery code").fill(first ?? "");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(formAlert(page)).toHaveText("That code didn't work. Check it and try again.");

  // Back to the authenticator code, and start over returns to the password step.
  await page.getByRole("button", { name: "Use an authenticator code instead" }).click();
  await expect(page.getByLabel("Authentication code")).toBeVisible();
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByLabel("Authentication code")).toHaveCount(0);

  // The other codes still work: the next test signs in with the second one.
  await logIn(page, TOTP_USER);
  await page.getByRole("button", { name: "Use a recovery code instead" }).click();
  await page.getByLabel("Recovery code").fill(second ?? "");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("login: errors from the second step are translated", async ({ page }) => {
  // Mocked: really exhausting the limiter would lock every other story out for 15 minutes.
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: { mfaRequired: true } }));
  await page.route("**/api/auth/login/totp", (route) =>
    route.fulfill({ status: 429, json: { error: { code: "too_many_attempts" } } }),
  );
  await logIn(page, TOTP_USER);
  await page.getByLabel("Authentication code").fill("123456");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(formAlert(page)).toHaveText(
    "Too many attempts for now. Please wait a few minutes and try again.",
  );
  await expect(formAlert(page)).toBeFocused();

  await page.unroute("**/api/auth/login/totp");
  await page.route("**/api/auth/login/totp", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "unauthenticated" } } }),
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(formAlert(page)).toHaveText("Your session has ended. Please log in again.");
});

test("activity: shows the sign-ins and changes, newest first, with Load more", async ({
  page,
  context,
  baseURL,
}) => {
  // A small page size makes "Load more" easy to exercise.
  await page.route("**/api/activity?*", (route) =>
    route.continue({ url: route.request().url().replace("limit=50", "limit=2") }),
  );
  await logIn(page, TOTP_USER);
  await page.getByRole("button", { name: "Use a recovery code instead" }).click();
  await page.getByLabel("Recovery code").fill(recoveryCodes[3] ?? "");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/settings");
  await page.getByRole("link", { name: "See your recent activity" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();

  const table = page.getByRole("table", { name: "Activity" });
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Signed in");
  await expect(rows.first()).toContainText("Method: Recovery code");

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("2 more events loaded.")).toBeVisible();
  await expect(rows).toHaveCount(4);

  const loadMore = page.getByRole("button", { name: "Load more" });
  const end = page.getByText("That's everything.");
  for (let page_ = 0; page_ < 30; page_ += 1) {
    await expect(loadMore.or(end)).toBeVisible();
    if (await end.isVisible()) {
      break;
    }
    await loadMore.click();
  }
  await expect(end).toBeFocused();

  await expect(table).toContainText("Two-step verification turned on");
  await expect(table).toContainText("Failed sign-in attempt");
  await expect(table).toContainText("Method: Authenticator code");
  await expect(table).toContainText("Signed out");
  await expect(table.getByRole("columnheader", { name: "IP address" })).toBeVisible();
  await expect(rows.first().locator("td").nth(2)).not.toContainText("Not recorded");
  const times = await table
    .locator("time")
    .evaluateAll((nodes) => nodes.map((node) => Date.parse(node.getAttribute("datetime") ?? "")));
  expect(times).toEqual([...times].sort((a, b) => b - a));
  await expectNoViolations(page);

  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  await setLocale(context, String(baseURL), "ca");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Activitat", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Activitat" })).toContainText("Sessió iniciada");
  await expectNoViolations(page);
});

test("settings: turn off two-step verification with the password and a recovery code", async ({
  page,
}) => {
  // Authenticator codes are single-use per 30 seconds, so sign in with another recovery code.
  await logIn(page, TOTP_USER);
  await page.getByRole("button", { name: "Use a recovery code instead" }).click();
  await page.getByLabel("Recovery code").fill(recoveryCodes[5] ?? "");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/settings");

  const totp = section(page, "Two-step verification");
  await expect(totp.getByText("You have 6 recovery codes left.")).toBeVisible();
  await totp.getByRole("button", { name: "Turn off" }).click();
  const dialog = page.getByRole("dialog", { name: "Turn off two-step verification?" });
  await expect(dialog).toBeVisible();
  await expectNoViolations(page);

  await dialog.getByLabel("Password").fill("not my password at all");
  await dialog.getByLabel("Code or recovery code").fill(recoveryCodes[4] ?? "");
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await expect(formAlert(page)).toHaveText(
    "That email and password don't match. Please try again.",
  );

  await dialog.getByLabel("Password").fill(TOTP_USER.password);
  await dialog.getByLabel("Code or recovery code").fill(recoveryCodes[4] ?? "");
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(totp.getByText("Two-step verification is off.").first()).toBeVisible();
  await expect(totp.getByRole("button", { name: "Set up" })).toBeVisible();

  // Signing in is back to just the password.
  await logOut(page);
  await logIn(page, TOTP_USER);
  await expect(page).toHaveURL(/\/$/);
});

// ---------------------------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------------------------

async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
}

test("passkeys: register one, sign in with it, then remove it", async ({ page }) => {
  await addVirtualAuthenticator(page);
  await logIn(page, PASSKEY_USER);
  await page.goto("/settings");

  const passkeys = section(page, "Passkeys");
  await expect(passkeys.getByText("You haven't added a passkey yet.")).toBeVisible();
  await passkeys.getByRole("button", { name: "Add a passkey" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a passkey" });
  await expect(dialog).toBeVisible();
  await expectNoViolations(page);

  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(formAlert(page)).toHaveText("Give the passkey a name.");
  await dialog.getByLabel("Name for this passkey").fill("Test laptop");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(formAlert(page)).toHaveText("Enter your password.");
  await expect(dialog.getByLabel("Password")).toBeFocused();
  await dialog.getByLabel("Password").fill(PASSKEY_USER.password);
  await dialog.getByRole("button", { name: "Continue" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(passkeys.getByText("Passkey “Test laptop” added.")).toBeVisible();
  const row = passkeys.getByRole("row", { name: /Test laptop/ });
  await expect(row).toContainText("Never");
  await expectNoViolations(page);

  // A second passkey on the same authenticator is refused, in plain words.
  await passkeys.getByRole("button", { name: "Add a passkey" }).click();
  await page.getByLabel("Name for this passkey").fill("Same device again");
  await dialog.getByLabel("Password").fill(PASSKEY_USER.password);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(formAlert(page)).toHaveText("This device already has a passkey for your account.");
  await page.getByRole("button", { name: "Cancel" }).click();

  await logOut(page);
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
  await expectNoViolations(page);

  // If the server refuses the passkey, the message is calm and says what to do.
  await page.route("**/api/auth/passkeys/login/verify", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "invalid_credentials" } } }),
  );
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(formAlert(page)).toHaveText(
    "That passkey didn't work. Try again, or sign in with your password.",
  );
  await expect(page).toHaveURL(/\/login$/);
  await page.unroute("**/api/auth/passkeys/login/verify");

  // Sign in with the passkey alone: no email, no password.
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(PASSKEY_USER.email)).toBeVisible();

  await page.goto("/settings");
  const used = section(page, "Passkeys").getByRole("row", { name: /Test laptop/ });
  await expect(used).not.toContainText("Never");

  await page.goto("/activity");
  await expect(page.getByRole("table", { name: "Activity" })).toContainText("Passkey: Test laptop");
  await expect(page.getByRole("table", { name: "Activity" })).toContainText("Passkey added");

  // Remove it, after a confirmation.
  await page.goto("/settings");
  await section(page, "Passkeys")
    .getByRole("button", { name: "Remove passkey Test laptop" })
    .click();
  const confirm = page.getByRole("dialog", { name: "Remove this passkey?" });
  await expect(confirm).toBeVisible();
  await expectNoViolations(page);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(section(page, "Passkeys").getByRole("row", { name: /Test laptop/ })).toBeVisible();
  await section(page, "Passkeys")
    .getByRole("button", { name: "Remove passkey Test laptop" })
    .click();
  await page
    .getByRole("dialog", { name: "Remove this passkey?" })
    .getByRole("button", { name: "Remove passkey" })
    .click();
  await expect(section(page, "Passkeys").getByText("Passkey “Test laptop” removed.")).toBeVisible();
  await expect(
    section(page, "Passkeys").getByText("You haven't added a passkey yet."),
  ).toBeVisible();
});

test("passkeys: cancelling the browser prompt is silent", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.credentials.get = () =>
      Promise.reject(new DOMException("The operation was not allowed.", "NotAllowedError"));
  });
  await page.goto("/login");
  const button = page.getByRole("button", { name: "Sign in with a passkey" });
  await button.click();
  await expect(button).toBeEnabled();
  await expect(formAlert(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/);
});

// ---------------------------------------------------------------------------------------------
// App passwords
// ---------------------------------------------------------------------------------------------

let appPasswordToken = "";

test("app passwords: create one, see the token once, use it as a Bearer token", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await logIn(page, TOKEN_USER);
  await page.goto("/settings");

  const apps = section(page, "App passwords");
  await expect(apps.getByText("You haven't created an app password yet.")).toBeVisible();
  await apps.getByRole("button", { name: "Create an app password" }).click();
  const dialog = page.getByRole("dialog", { name: "Create an app password" });
  await expect(dialog).toBeVisible();
  await expectNoViolations(page);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(formAlert(page)).toHaveText("Give the app password a name.");
  await dialog.getByLabel("What is it for?").fill("Backup script");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(formAlert(page)).toHaveText("Enter your password.");
  await dialog.getByLabel("Password").fill("definitely not my password");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(formAlert(page)).toHaveText("That password isn't right. Check it and try again.");
  await expect(dialog.getByLabel("Password")).toBeFocused();
  await dialog.getByLabel("Password").fill(TOKEN_USER.password);
  await dialog.getByRole("button", { name: "Create" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your new app password" })).toBeFocused();
  const tokenField = page.getByLabel("App password", { exact: true });
  appPasswordToken = await tokenField.inputValue();
  expect(appPasswordToken).toMatch(/^cloud_[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText("It won't be shown again.")).toBeVisible();
  await expect(page.getByText("Use it as the password in WebDAV")).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByText("Copied to the clipboard")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(appPasswordToken);

  const row = apps.getByRole("row", { name: /Backup script/ });
  await expect(row).toContainText("Never");

  // As a Bearer token it opens the API, but never the account or admin routes.
  const me = await page.request.get("/api/auth/me", {
    headers: { authorization: `Bearer ${appPasswordToken}` },
  });
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { user: { email: string } }).user.email).toBe(TOKEN_USER.email);
  const admin = await page.request.get("/api/admin/users", {
    headers: { authorization: `Bearer ${appPasswordToken}` },
  });
  expect(admin.status()).toBe(404);
  const wrong = await page.request.get("/api/auth/me", {
    headers: { authorization: "Bearer cloud_nope" },
  });
  expect(wrong.status()).toBe(401);

  // Hiding the token is final; the list shows the password's name and when it was last used.
  await page.getByRole("button", { name: "Hide app password" }).click();
  await expect(page.getByLabel("App password", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("App password", { exact: true })).toHaveCount(0);
  const reloaded = section(page, "App passwords").getByRole("row", { name: /Backup script/ });
  await expect(reloaded).toBeVisible();
  await expect(reloaded).not.toContainText("Never");

  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  await setLocale(context, String(baseURL), "ca");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Contrasenyes d'aplicació" })).toBeVisible();
  await expectNoViolations(page);
});

test("app passwords: revoking stops the token working", async ({ page, context, baseURL }) => {
  await setLocale(context, String(baseURL), "en");
  await logIn(page, TOKEN_USER);
  await page.goto("/settings");
  const apps = section(page, "App passwords");
  await apps.getByRole("button", { name: "Revoke app password Backup script" }).click();
  const confirm = page.getByRole("dialog", { name: "Revoke this app password?" });
  await expect(confirm).toBeVisible();
  await expectNoViolations(page);
  await confirm.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(apps.getByText("App password “Backup script” revoked.")).toBeVisible();
  await expect(apps.getByText("You haven't created an app password yet.")).toBeVisible();

  const revoked = await page.request.get("/api/auth/me", {
    headers: { authorization: `Bearer ${appPasswordToken}` },
  });
  expect(revoked.status()).toBe(401);

  await page.goto("/activity");
  const table = page.getByRole("table", { name: "Activity" });
  await expect(table).toContainText("App password revoked");
  await expect(table).toContainText("App password created");
  await expect(table).toContainText("App password: Backup script");
});

test("app passwords: with two-step verification on, the dialog also asks for a code", async ({
  page,
  context,
  baseURL,
}) => {
  await setLocale(context, String(baseURL), "en");
  await logIn(page, TOKEN_USER);
  // Mocked: this account has no second factor, and the server side is covered by the API tests.
  await page.route("**/api/auth/totp", (route) =>
    route.fulfill({ json: { enabled: true, recoveryCodesLeft: 4 } }),
  );
  let sent: unknown;
  await page.route("**/api/auth/app-passwords", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 401, json: { error: { code: "invalid_code" } } });
  });
  await page.goto("/settings");

  await section(page, "App passwords")
    .getByRole("button", { name: "Create an app password" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Create an app password" });
  await dialog.getByLabel("What is it for?").fill("Mocked");
  await dialog.getByLabel("Password").fill(TOKEN_USER.password);
  await expect(dialog.getByLabel("Code from your app or a recovery code")).toBeVisible();
  await expectNoViolations(page);

  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(formAlert(page)).toHaveText("Enter the code from your authenticator app.");
  await dialog.getByLabel("Code from your app or a recovery code").fill(" 123 456 ");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(formAlert(page)).toHaveText("That code didn't work. Check it and try again.");
  await expect(dialog.getByLabel("Code from your app or a recovery code")).toBeFocused();
  expect(sent).toEqual({ name: "Mocked", password: TOKEN_USER.password, code: "123456" });
});

// ---------------------------------------------------------------------------------------------
// Sessions and password
// ---------------------------------------------------------------------------------------------

test("settings: sign out of other devices ends every other session and keeps this one", async ({
  page,
  playwright,
  context,
  baseURL,
}) => {
  const origin = String(baseURL);
  await setLocale(context, origin, "en");
  const other = await apiClient(playwright, origin);
  expect((await other.post("/api/auth/login", { data: SESSION_USER })).ok()).toBe(true);
  expect((await other.get("/api/auth/me")).status()).toBe(200);

  await logIn(page, SESSION_USER);
  await page.goto("/settings");
  const devices = section(page, "Signed-in devices");
  await devices.getByRole("button", { name: "Sign out of other devices" }).click();
  const confirm = page.getByRole("dialog", { name: "Sign out of other devices?" });
  await expect(confirm).toBeVisible();
  await expectNoViolations(page);

  // Cancel changes nothing.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  expect((await other.get("/api/auth/me")).status()).toBe(200);

  await devices.getByRole("button", { name: "Sign out of other devices" }).click();
  await page
    .getByRole("dialog", { name: "Sign out of other devices?" })
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(devices.getByText("Signed out of all other devices.")).toBeVisible();
  expect((await other.get("/api/auth/me")).status()).toBe(401);

  // This browser is still signed in.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Security", level: 1 })).toBeVisible();
  await other.dispose();
});

test("settings: change the password", async ({ page, playwright, context, baseURL }) => {
  const origin = String(baseURL);
  const other = await apiClient(playwright, origin);
  expect((await other.post("/api/auth/login", { data: SESSION_USER })).ok()).toBe(true);

  await logIn(page, SESSION_USER);
  await page.goto("/settings");
  const form = section(page, "Your password");
  const submit = form.getByRole("button", { name: "Change password" });
  await expectNoViolations(page);

  await submit.click();
  await expect(formAlert(page)).toHaveText("Enter your password.");
  await expect(form.getByLabel("Current password")).toBeFocused();
  await form.getByLabel("Current password").fill("not my password at all");
  await form.getByLabel("New password").fill("short");
  await submit.click();
  await expect(formAlert(page)).toHaveText("The password needs at least 12 characters.");
  await form.getByLabel("New password").fill(NEW_PASSWORD);
  await form.getByLabel("Confirm password").fill(`${NEW_PASSWORD} typo`);
  await submit.click();
  await expect(formAlert(page)).toHaveText("The two passwords don't match.");
  await form.getByLabel("Confirm password").fill(NEW_PASSWORD);
  await submit.click();
  await expect(formAlert(page)).toHaveText("That password isn't right. Check it and try again.");
  await expect(form.getByLabel("Current password")).toBeFocused();

  await form.getByLabel("Current password").fill(SESSION_USER.password);
  await submit.click();
  await expect(
    form.getByText("Password changed. Other devices have been signed out."),
  ).toBeVisible();
  await expect(form.getByLabel("Current password")).toHaveValue("");
  await expect(form.getByLabel("New password")).toHaveValue("");
  await expectNoViolations(page);

  // The other session ended, this one did not, and only the new password signs in.
  expect((await other.get("/api/auth/me")).status()).toBe(401);
  await other.dispose();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Security", level: 1 })).toBeVisible();
  const fresh = await apiClient(playwright, origin);
  expect((await fresh.post("/api/auth/login", { data: SESSION_USER })).status()).toBe(401);
  expect(
    (
      await fresh.post("/api/auth/login", { data: { ...SESSION_USER, password: NEW_PASSWORD } })
    ).ok(),
  ).toBe(true);
  await fresh.dispose();

  await page.goto("/activity");
  await expect(page.getByRole("table", { name: "Activity" })).toContainText("Password changed");

  await setLocale(context, origin, "ca");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "La teva contrasenya" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dispositius amb la sessió iniciada" }),
  ).toBeVisible();
  await expectNoViolations(page);
});

// ---------------------------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------------------------

test("admin: reset a member's two-step verification and see it in the security activity", async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const origin = String(baseURL);
  await createMember(playwright, origin, LOST_PHONE_USER);
  const member = await apiClient(playwright, origin);
  expect((await member.post("/api/auth/login", { data: LOST_PHONE_USER })).ok()).toBe(true);
  const setup = await member.post("/api/auth/totp/setup");
  const { secret: key } = (await setup.json()) as { secret: string };
  expect((await member.post("/api/auth/totp/enable", { data: { code: totpCode(key) } })).ok()).toBe(
    true,
  );
  await member.dispose();

  const guarded = await apiClient(playwright, origin);
  const asked = await guarded.post("/api/auth/login", { data: LOST_PHONE_USER });
  expect(await asked.json()).toEqual({ mfaRequired: true });
  await guarded.dispose();

  await logIn(page, ADMIN);
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // No reset on your own row.
  const users = page.getByRole("table", { name: "Users" });
  const own = users.getByRole("row", { name: new RegExp(ADMIN.email) });
  await expect(own.getByRole("button", { name: /^Reset two-step verification/ })).toHaveCount(0);

  const row = users.getByRole("row", { name: new RegExp(LOST_PHONE_USER.email) });
  await row
    .getByRole("button", { name: `Reset two-step verification for ${LOST_PHONE_USER.email}` })
    .click();
  const dialog = page.getByRole("dialog", { name: "Reset two-step verification?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(LOST_PHONE_USER.email);
  await expectNoViolations(page);

  // Cancel changes nothing.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  const stillOn = await apiClient(playwright, origin);
  expect(await (await stillOn.post("/api/auth/login", { data: LOST_PHONE_USER })).json()).toEqual({
    mfaRequired: true,
  });
  await stillOn.dispose();

  await row
    .getByRole("button", { name: `Reset two-step verification for ${LOST_PHONE_USER.email}` })
    .click();
  await page
    .getByRole("dialog", { name: "Reset two-step verification?" })
    .getByRole("button", { name: "Reset", exact: true })
    .click();
  await expect(
    row.getByText(`Two-step verification reset for ${LOST_PHONE_USER.email}.`),
  ).toBeVisible();

  // The member now signs in with just the password.
  const after = await apiClient(playwright, origin);
  const login = await after.post("/api/auth/login", { data: LOST_PHONE_USER });
  expect(((await login.json()) as { user?: { email: string } }).user?.email).toBe(
    LOST_PHONE_USER.email,
  );
  await after.dispose();

  // The security activity lists it, with the account and who did it.
  await page.reload();
  const activity = page.getByRole("table", { name: "Security activity" });
  const entry = activity.getByRole("row", { name: /Two-step verification reset by an admin/ });
  await expect(entry.first()).toContainText(LOST_PHONE_USER.email);
  await expect(entry.first()).toContainText(`Done by ${ADMIN.email}`);
  await expect(activity.getByRole("columnheader", { name: "Account" })).toBeVisible();
  await expect(activity).toContainText("Signed in");
  await expectNoViolations(page);

  await setLocale(context, origin, "ca");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Activitat de seguretat" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Activitat de seguretat" })).toContainText(
    "Verificació en dos passos restablerta per un administrador",
  );
  await expectNoViolations(page);
});
