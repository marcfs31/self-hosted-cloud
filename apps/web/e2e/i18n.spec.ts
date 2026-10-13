import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The login page needs no account, so these tests work before or after the first-run story.
const LOGIN_HEADING = {
  en: "Log in",
  "pt-PT": "Iniciar sessão",
  es: "Iniciar sesión",
  ca: "Inicia la sessió",
  it: "Accedi",
} as const;

const LOCALE_NAME = {
  en: "English",
  "pt-PT": "Português",
  es: "Español",
  ca: "Català",
  it: "Italiano",
} as const;

const NO_ACCOUNT = {
  en: "Need an account?",
  "pt-PT": "Precisa de uma conta?",
  es: "¿Necesitas una cuenta?",
  ca: "Necessites un compte?",
  it: "Ti serve un account?",
} as const;

const LANGUAGE_LABEL = {
  en: "Language",
  "pt-PT": "Idioma",
  es: "Idioma",
  ca: "Llengua",
  it: "Lingua",
} as const;

type Locale = keyof typeof LOGIN_HEADING;
const LOCALES = Object.keys(LOGIN_HEADING) as Locale[];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

for (const locale of LOCALES) {
  test(`login page in ${locale} is translated and accessible`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: "locale", value: locale, url: String(baseURL) }]);
    await page.goto("/login");

    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { name: LOGIN_HEADING[locale], level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(NO_ACCOUNT[locale], { exact: false })).toBeVisible();
    await expect(page.getByLabel(LANGUAGE_LABEL[locale])).toHaveValue(locale);
    await expect(page).toHaveTitle(new RegExp(`^${LOGIN_HEADING[locale]} · Cloud$`));
    await expectNoViolations(page);
  });
}

test("with no cookie and an English browser the page is English", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Log in", level: 1 })).toBeVisible();
});

test.describe("browser language", () => {
  test.use({ locale: "ca-ES" });

  test("is used when there is no cookie, and the cookie wins over it", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "ca");
    await expect(page.getByRole("heading", { name: LOGIN_HEADING.ca, level: 1 })).toBeVisible();

    await context.addCookies([{ name: "locale", value: "it", url: String(baseURL) }]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "it");
  });
});

test("switching the language with the switcher translates the page and is remembered", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const switcher = page.getByLabel("Language");
  await expect(switcher.locator("option")).toHaveText(Object.values(LOCALE_NAME));
  await expect(switcher.locator('option[value="es"]')).toHaveAttribute("lang", "es");

  await switcher.selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { name: LOGIN_HEADING.es, level: 1 })).toBeVisible();
  await expect(page.getByLabel("Idioma")).toHaveValue("es");
  await expect(page).toHaveTitle(/^Iniciar sesión · Cloud$/);

  const cookie = (await context.cookies()).find((c) => c.name === "locale");
  expect(cookie).toMatchObject({ value: "es", path: "/", sameSite: "Lax" });
  expect((cookie?.expires ?? 0) - Date.now() / 1000).toBeGreaterThan(60 * 60 * 24 * 364);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expectNoViolations(page);
});

const ADMIN = { email: "admin@example.test", password: "correct horse battery staple" };

// auth.spec.ts creates this admin; when this file runs on its own, create it here.
async function signInAsAdmin(page: Page) {
  const status = await page.request.get("/api/auth/setup");
  const { needsSetup } = (await status.json()) as { needsSetup: boolean };
  if (needsSetup) {
    await page.goto("/setup");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
    await page.getByLabel("Confirm password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Create admin account" }).click();
    await expect(page.getByRole("heading", { name: "Files", level: 1 })).toBeVisible();
    return;
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Files", level: 1 })).toBeVisible();
}

test("the signed-in header switches language and the admin page follows", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();

  await page.getByLabel("Language").selectOption("pt-PT");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-PT");
  await expect(page.getByRole("heading", { name: "Administração", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Utilizadores" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Terminar sessão" })).toBeVisible();
  await expect(page).toHaveTitle(/^Administração · Cloud$/);
  await expectNoViolations(page);

  await page.getByLabel("Idioma").selectOption("ca");
  await expect(page.getByRole("heading", { name: "Administració", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Usuaris" })).toBeVisible();
  await expectNoViolations(page);
});
