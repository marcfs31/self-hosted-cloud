import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// These tests share one server and database, so they run in order as a single story:
// first run → admin → invite → member → log in again.
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.test", password: "correct horse battery staple" };
const MEMBER = { email: "member@example.test", password: "another long test passphrase" };

let inviteLink = "";

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

async function logOut(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test("first run redirects to setup, which has no accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Set up your cloud" })).toBeVisible();
  await expect(page.getByText("At least 12 characters", { exact: false })).toBeVisible();
  await expectNoViolations(page);
});

test("setup validates the password before creating the admin", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("short");
  await page.getByRole("button", { name: "Create admin account" }).click();
  const alert = formAlert(page);
  await expect(alert).toHaveText("The password needs at least 12 characters.");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();

  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Confirm password").fill(`${ADMIN.password}x`);
  await page.getByRole("button", { name: "Create admin account" }).click();
  await expect(alert).toHaveText("The two passwords don't match.");
  await expect(page.getByLabel("Confirm password")).toBeFocused();
});

test("setup creates the admin and signs them in", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Confirm password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create admin account" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(`Signed in as ${ADMIN.email}`)).toBeVisible();
  await expect(page.getByText("File browsing arrives in the next release.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
  await expectNoViolations(page);
});

test("admin creates an invite and sees the link once", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();

  const users = page.getByRole("table", { name: "Users" });
  await expect(users.getByRole("row", { name: new RegExp(ADMIN.email) })).toContainText("You");

  await page.getByRole("button", { name: "Create invite" }).click();
  const link = page.getByRole("textbox", { name: "Invite link" });
  await expect(link).toBeVisible();
  await expect(page.getByText("This link won't be shown again", { exact: false })).toBeVisible();
  inviteLink = await link.inputValue();
  expect(inviteLink).toMatch(/^http:\/\/localhost:3100\/register\?token=.+/);

  const invites = page.getByRole("table", { name: "Invites" });
  await expect(invites.getByRole("row").nth(1)).toContainText("Active");
  await expectNoViolations(page);

  // The link is not kept anywhere: hiding it, or reloading, loses it.
  await page.getByRole("button", { name: "Hide link" }).click();
  await expect(page.getByRole("textbox", { name: "Invite link" })).toHaveCount(0);
  await expect(invites.getByRole("row").nth(1)).toContainText("Active");

  await logOut(page);
  await expectNoViolations(page);
});

test("a member registers from the invite link and has no admin access", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) });
  const page = await context.newPage();

  await page.goto(inviteLink);
  await expect(page.getByRole("heading", { name: "Accept your invite" })).toBeVisible();
  await expectNoViolations(page);

  await page.getByLabel("Email").fill(MEMBER.email);
  await page.getByLabel("Password", { exact: true }).fill(MEMBER.password);
  await page.getByLabel("Confirm password").fill(MEMBER.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(`Signed in as ${MEMBER.email}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  await logOut(page);

  // The invite is single-use.
  await page.goto(inviteLink);
  await page.getByLabel("Email").fill("someone-else@example.test");
  await page.getByLabel("Password", { exact: true }).fill(MEMBER.password);
  await page.getByLabel("Confirm password").fill(MEMBER.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(formAlert(page)).toHaveText(
    "This invite link isn't valid any more. Ask the admin for a new one.",
  );
  await context.close();
});

test("an incomplete invite link explains itself", async ({ page }) => {
  await page.goto("/register");
  await expect(formAlert(page)).toContainText("incomplete");
  await expectNoViolations(page);
});

test("login rejects a bad password and accepts the right one", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);

  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("not the right password");
  await page.getByRole("button", { name: "Log in" }).click();
  const alert = formAlert(page);
  await expect(alert).toHaveText("That email and password don't match. Please try again.");
  await expect(alert).toBeFocused();

  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Log in" }).click();

  // The original destination is preserved through login.
  await expect(page).toHaveURL(/\/admin$/);
  const users = page.getByRole("table", { name: "Users" });
  await expect(users.getByRole("row", { name: new RegExp(MEMBER.email) })).toBeVisible();
  await expectNoViolations(page);
});

test("admin changes a member's quota", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Admin" }).click();

  const row = page.getByRole("row", { name: new RegExp(MEMBER.email) });
  const quota = row.getByLabel(`Quota in GiB for ${MEMBER.email}`);
  await expect(quota).toHaveValue("100");
  await quota.fill("1.5");
  await row.getByRole("button", { name: /^Save/ }).click();
  await expect(row.getByText("Saved")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("row", { name: new RegExp(MEMBER.email) }).getByLabel(/^Quota in GiB/),
  ).toHaveValue("1.5");

  await quota.fill("lots");
  await row.getByRole("button", { name: /^Save/ }).click();
  await expect(row.getByRole("alert")).toContainText("number of GiB");
  await expect(quota).toBeFocused();
});

test("admin revokes an unused invite", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Admin" }).click();

  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByRole("textbox", { name: "Invite link" })).toBeVisible();
  const revoke = page.getByRole("button", { name: /^Revoke/ });
  await expect(revoke).toHaveCount(1);
  await revoke.click();
  await expect(revoke).toHaveCount(0);
});

test("login page stays accessible in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expectNoViolations(page);
});

test("pages fit a 320px screen without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page.getByRole("heading", { name: "Invites" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
