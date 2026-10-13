import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

// One story on one account, so the tests run in order and share a page.
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.test", password: "correct horse battery staple" };

// A 1x1 PNG, built from bytes inside the test.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const NOTES = "Quokkas smile at everyone.\nHello from the preview.";
const README = "# Quokka\n\nMarkdown **source** stays text, never HTML.";
// Longer than the 1 MiB a text preview reads.
const BIG = "quokka line of text\n".repeat(80_000);
const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

let context: BrowserContext;
let page: Page;
let origin = "";
let zooId = "";
let parkId = "";

async function signIn(request: APIRequestContext) {
  const headers = { origin };
  const status = await request.get("/api/auth/setup");
  const { needsSetup } = (await status.json()) as { needsSetup: boolean };
  const response = needsSetup
    ? await request.post("/api/auth/setup", { headers, data: ADMIN })
    : await request.post("/api/auth/login", { headers, data: ADMIN });
  expect(response.ok()).toBe(true);
}

async function makeFolder(parentId: string, name: string): Promise<string> {
  const response = await context.request.post("/api/folders", {
    headers: { origin },
    data: { parentId, name },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

test.beforeAll(async ({ browser }, testInfo) => {
  origin = String(testInfo.project.use.baseURL);
  context = await browser.newContext({ baseURL: origin });
  page = await context.newPage();
  await signIn(context.request);
  const root = (await (await context.request.get("/api/files/root")).json()) as {
    folder: { id: string };
  };
  zooId = await makeFolder(root.folder.id, "Zoo");
  parkId = await makeFolder(zooId, "Quokka Park");
});

test.afterAll(async () => {
  await context.close();
});

async function expectNoViolations() {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function setLocale(locale: "en" | "ca") {
  await context.addCookies([{ name: "locale", value: locale, url: origin }]);
}

const searchField = () => page.getByRole("searchbox", { name: /^(Search files|Cerca fitxers)$/ });
const nameButton = (name: string) => page.getByRole("button", { name, exact: true });
const previewDialog = (name: string) => page.getByRole("dialog", { name });

function rowOf(name: string): Locator {
  return page.getByRole("row").filter({ hasText: name });
}

async function expectNoSideScroll() {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("files uploaded in a folder are listed, and previewable names open the preview", async () => {
  await page.goto(`/folders/${parkId}`);
  await expect(page.getByRole("heading", { name: "Quokka Park", level: 1 })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "quokka-photo.png", mimeType: "image/png", buffer: PNG },
    { name: "quokka-notes.txt", mimeType: "text/plain", buffer: Buffer.from(NOTES) },
    { name: "quokka-readme.md", mimeType: "text/markdown", buffer: Buffer.from(README) },
    { name: "quokka-big.txt", mimeType: "text/plain", buffer: Buffer.from(BIG) },
    { name: "quokka-archive.zip", mimeType: "application/zip", buffer: Buffer.from("PK") },
  ]);
  for (const name of [
    "quokka-archive.zip",
    "quokka-big.txt",
    "quokka-notes.txt",
    "quokka-photo.png",
    "quokka-readme.md",
  ]) {
    await expect(rowOf(name)).toBeVisible();
  }

  // A type that cannot be previewed is plain text, not a control.
  await expect(nameButton("quokka-archive.zip")).toHaveCount(0);
  await expect(nameButton("quokka-notes.txt")).toBeVisible();
});

test("a text file previews as text, and Escape puts the focus back on its name", async () => {
  await nameButton("quokka-notes.txt").click();
  const dialog = previewDialog("quokka-notes.txt");
  await expect(dialog).toBeVisible();
  const text = dialog.getByRole("region", { name: "quokka-notes.txt" });
  await expect(text).toHaveText(NOTES);
  await expect(dialog.getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    /\/api\/files\/[^/]+\/content\?download=1$/,
  );
  await expect(dialog.getByText("2 of 4")).toBeVisible();
  await expectNoViolations();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(nameButton("quokka-notes.txt")).toBeFocused();
});

test("next and previous step through the previewable files, by button and arrow key", async () => {
  await nameButton("quokka-big.txt").click();
  const big = previewDialog("quokka-big.txt");
  await expect(big.getByText("1 of 4")).toBeVisible();
  await expect(big.getByRole("button", { name: "Previous file" })).toBeDisabled();

  // The first MiB only, and the dialog says so.
  await expect(
    big.getByRole("status").filter({ hasText: "Showing the first 1 MiB" }),
  ).toBeVisible();
  const shown = (await big.getByRole("region", { name: "quokka-big.txt" }).textContent()) ?? "";
  expect(shown.length).toBeGreaterThan(1_000_000);
  expect(shown.length).toBeLessThanOrEqual(1024 * 1024);

  await big.getByRole("button", { name: "Next file" }).click();
  const notes = previewDialog("quokka-notes.txt");
  await expect(notes.getByRole("region", { name: "quokka-notes.txt" })).toHaveText(NOTES);
  await expect(notes.getByRole("button", { name: "Next file" })).toBeFocused();

  await page.keyboard.press("ArrowRight");
  const photo = previewDialog("quokka-photo.png");
  await expect(photo.getByText("3 of 4")).toBeVisible();
  const image = photo.getByRole("img", { name: "quokka-photo.png" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  await expectNoViolations();

  await page.keyboard.press("ArrowRight");
  const readme = previewDialog("quokka-readme.md");
  // Markdown is shown as its source, never rendered.
  await expect(readme.getByRole("region", { name: "quokka-readme.md" })).toHaveText(README);
  await expect(readme.locator("strong, h1")).toHaveCount(0);
  const next = readme.getByRole("button", { name: "Next file" });
  await expect(next).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(readme).toBeVisible();

  await page.keyboard.press("ArrowLeft");
  await expect(previewDialog("quokka-photo.png")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(previewDialog("quokka-notes.txt")).toBeVisible();
  await page.getByRole("button", { name: "Previous file" }).click();
  await expect(previewDialog("quokka-big.txt")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(previewDialog("quokka-notes.txt")).toBeVisible();

  // The focus goes back to the row of the file shown last.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(nameButton("quokka-notes.txt")).toBeFocused();
});

test("a PDF is framed from the content URL with a title", async () => {
  const folderId = await makeFolder(zooId, "Papers");
  await page.goto(`/folders/${folderId}`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "paper.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await expect(rowOf("paper.pdf")).toBeVisible();
  await nameButton("paper.pdf").click();
  const frame = previewDialog("paper.pdf").locator("iframe");
  await expect(frame).toHaveAttribute("title", "paper.pdf");
  await expect(frame).toHaveAttribute("src", /^\/api\/files\/[^/]+\/content$/);
  await page.keyboard.press("Escape");
  await expect(nameButton("paper.pdf")).toBeFocused();
});

test("/ focuses the search field, except while typing in a field", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My files", level: 1 })).toBeVisible();
  await expect(searchField()).not.toBeFocused();
  await page.keyboard.press("/");
  await expect(searchField()).toBeFocused();
  await expect(searchField()).toHaveValue("");

  // In a text field the slash is just a character.
  await page.keyboard.type("a/b");
  await expect(searchField()).toHaveValue("a/b");

  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog.getByLabel("Folder name")).toBeFocused();
  await page.keyboard.type("x/y");
  await expect(dialog.getByLabel("Folder name")).toHaveValue("x/y");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("submitting the search finds files by a part of the name, with the folder path", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My files", level: 1 })).toBeVisible();
  await page.keyboard.press("/");
  await expect(searchField()).toBeFocused();
  await page.keyboard.type("okka-n");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/search\?q=okka-n$/);
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/^Search · Cloud$/);
  await expect(page.getByRole("status").filter({ hasText: "result" })).toHaveText(
    "1 result for “okka-n”",
  );
  const row = rowOf("quokka-notes.txt");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`${Buffer.byteLength(NOTES)} B`);
  const where = row.getByRole("list", { name: "Where quokka-notes.txt is" });
  await expect(where.getByRole("listitem")).toHaveText(["My files", "Zoo", "Quokka Park"]);
  await expect(searchField()).toHaveValue("okka-n");
  await expectNoViolations();
});

test("results follow what is typed after a short pause, and the count is announced", async () => {
  await searchField().fill("quokka");
  await expect(page).toHaveURL(/\/search\?q=quokka$/);
  const count = page.getByRole("status").filter({ hasText: /for “/ });
  await expect(count).toHaveText("6 results for “quokka”");
  await expect(page.getByRole("row").filter({ hasText: /^Quokka ParkFolder/ })).toHaveCount(1);
  await expect(rowOf("quokka-photo.png")).toHaveCount(1);

  await searchField().fill("quokka-p");
  await expect(count).toHaveText("1 result for “quokka-p”");

  await searchField().fill("");
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByText("Type part of a file or folder name to find it.")).toBeVisible();
});

test("a missing name shows an empty state, and a failing search an alert with Try again", async () => {
  await searchField().fill("zzzqqq");
  await expect(page.getByText("Nothing found for “zzzqqq”")).toBeVisible();
  await expect(
    page.getByText("Check the spelling, or try a shorter part of the name."),
  ).toBeVisible();

  await page.route(/\/api\/search\?/, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "internal" } }),
    }),
  );
  await searchField().fill("quokka-n");
  const alert = page.getByRole("alert").filter({ hasText: "Something went wrong on our side." });
  await expect(alert).toBeVisible();
  await page.unroute(/\/api\/search\?/);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toHaveCount(0);
  await expect(rowOf("quokka-notes.txt")).toHaveCount(1);
});

test("a folder result opens the folder, and an ancestor link opens that folder", async () => {
  await page.goto("/search?q=Quokka%20Park");
  await expect(page.getByRole("status").filter({ hasText: "result" })).toHaveText(
    "1 result for “Quokka Park”",
  );
  await expect(rowOf("Quokka Park")).toContainText("Folder");
  await page
    .getByRole("table")
    .getByRole("link", { name: "Quokka Park", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/folders/${parkId}$`));
  await expect(page.getByRole("heading", { name: "Quokka Park", level: 1 })).toBeVisible();

  await page.goto("/search?q=quokka-notes");
  await rowOf("quokka-notes.txt").getByRole("link", { name: "Zoo" }).click();
  await expect(page).toHaveURL(new RegExp(`/folders/${zooId}$`));
  await expect(page.getByRole("heading", { name: "Zoo", level: 1 })).toBeVisible();
});

test("a file result opens its preview, and other types offer a download", async () => {
  await page.goto("/search?q=quokka-notes");
  await nameButton("quokka-notes.txt").click();
  const dialog = previewDialog("quokka-notes.txt");
  await expect(dialog.getByRole("region", { name: "quokka-notes.txt" })).toHaveText(NOTES);
  await expect(dialog.getByText("1 of 1")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(nameButton("quokka-notes.txt")).toBeFocused();

  await searchField().fill("quokka-archive");
  await nameButton("quokka-archive.zip").click();
  const archive = previewDialog("quokka-archive.zip");
  await expect(archive.getByText("This type of file can't be shown here.")).toBeVisible();
  await expect(archive.getByText("2 B")).toBeVisible();
  await expect(archive.getByRole("link", { name: "Download" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(archive).toHaveCount(0);
  await expect(nameButton("quokka-archive.zip")).toBeFocused();
});

test("search and preview are accessible in Catalan too", async () => {
  await setLocale("ca");
  await page.goto("/search?q=quokka");
  await expect(page.getByRole("heading", { name: "Cerca", level: 1 })).toBeVisible();
  await expect(searchField()).toHaveValue("quokka");
  await expect(page.getByRole("status").filter({ hasText: "resultats" })).toHaveText(
    "6 resultats per a «quokka»",
  );
  await expectNoViolations();

  await nameButton("quokka-notes.txt").click();
  const dialog = previewDialog("quokka-notes.txt");
  await expect(dialog.getByRole("button", { name: "Fitxer següent" })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "quokka-notes.txt" })).toHaveText(NOTES);
  await expectNoViolations();
  await page.keyboard.press("Escape");
  await setLocale("en");
});

test("the search page and the preview fit a 320 px screen", async () => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/search?q=quokka");
  await expect(rowOf("quokka-photo.png")).toBeVisible();
  await expectNoSideScroll();
  await expectNoViolations();

  await nameButton("quokka-photo.png").click();
  await expect(previewDialog("quokka-photo.png").getByRole("img")).toBeVisible();
  await expectNoSideScroll();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });
});
