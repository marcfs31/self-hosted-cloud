import { ADMIN_NAV } from "./nav";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

// One story on one account: the owner shares things and strangers open the links in a second
// browser that has no session, so the tests run in order and share their pages.
test.describe.configure({ mode: "serial" });

const ADMIN = { email: "admin@example.test", password: "correct horse battery staple" };
const SECRET = "open sesame please";

// A 1x1 PNG, so the image preview has real pixels to load.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let ownerContext: BrowserContext;
let owner: Page;
let anonContext: BrowserContext;
let origin = "";
let rootId = "";
const ids: Record<string, string> = {};
const links: Record<string, string> = {};

async function signIn(request: APIRequestContext) {
  const headers = { origin };
  const status = await request.get("/api/auth/setup");
  const { needsSetup } = (await status.json()) as { needsSetup: boolean };
  const response = needsSetup
    ? await request.post("/api/auth/setup", { headers, data: ADMIN })
    : await request.post("/api/auth/login", { headers, data: ADMIN });
  expect(response.ok()).toBe(true);
}

function b64(text: string): string {
  return Buffer.from(text).toString("base64");
}

async function mkdir(parentId: string, name: string): Promise<string> {
  const response = await ownerContext.request.post("/api/folders", {
    headers: { origin },
    data: { parentId, name },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function putFile(parentId: string, name: string, content: Buffer, mime: string) {
  const created = await ownerContext.request.post("/api/uploads", {
    headers: {
      origin,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(content.length),
      "Upload-Metadata": `filename ${b64(name)},parentId ${b64(parentId)},filetype ${b64(mime)}`,
    },
  });
  expect(created.status()).toBe(201);
  const location = new URL(created.headers()["location"] ?? "", origin).pathname;
  const done = await ownerContext.request.patch(location, {
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

async function putText(parentId: string, name: string, text: string) {
  return putFile(parentId, name, Buffer.from(text), "text/plain");
}

async function apiShare(fileId: string, extra: object = {}): Promise<string> {
  const response = await ownerContext.request.post("/api/shares", {
    headers: { origin },
    data: { fileId, ...extra },
  });
  expect(response.status()).toBe(201);
  const { token } = (await response.json()) as { token: string };
  return `${origin}/s/${token}`;
}

function tokenOf(link: string): string {
  return link.slice(link.lastIndexOf("/") + 1);
}

test.beforeAll(async ({ browser }, testInfo) => {
  origin = String(testInfo.project.use.baseURL);
  ownerContext = await browser.newContext({ baseURL: origin });
  await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  owner = await ownerContext.newPage();
  await signIn(ownerContext.request);
  // Strangers: a browser with no cookies at all.
  anonContext = await browser.newContext({ baseURL: origin });

  const root = await ownerContext.request.get("/api/files/root");
  rootId = ((await root.json()) as { folder: { id: string } }).folder.id;
  ids["hello"] = await putText(rootId, "hello-share.txt", "hello from the owner");
  ids["secret"] = await putText(rootId, "secret-plans.txt", "the secret plans");
  ids["pixel"] = await putFile(rootId, "pixel.png", PIXEL, "image/png");
  ids["photos"] = await mkdir(rootId, "Photos");
  await putText(ids["photos"], "a.txt", "file a");
  ids["trips"] = await mkdir(ids["photos"], "Trips");
  await putText(ids["trips"], "b.txt", "file b in trips");
  ids["inbox"] = await mkdir(rootId, "Inbox");
});

test.afterAll(async () => {
  await ownerContext.close();
  await anonContext.close();
});

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function setLocale(context: BrowserContext, locale: "en" | "pt-PT") {
  await context.addCookies([{ name: "locale", value: locale, url: origin }]);
}

// Next.js adds its own role="alert" route announcer to every page; it is not an error message.
function formAlert(page: Page): Locator {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

function rowOf(name: string): Locator {
  return owner.getByRole("row").filter({ hasText: name });
}

async function chooseFromMenu(name: string, label: string, item: string) {
  await rowOf(name)
    .getByRole("button", { name: `${label} ${name}` })
    .click();
  await owner.getByRole("menuitem", { name: item }).click();
}

/** Opens the Share dialog of a row on the owner's current page. */
async function openShareDialog(name: string): Promise<Locator> {
  await chooseFromMenu(name, "Actions for", "Share…");
  const dialog = owner.getByRole("dialog", { name: `Share ${name}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Creates a link in the open dialog and returns it, then closes the dialog. */
async function createLink(dialog: Locator): Promise<string> {
  await dialog.getByRole("button", { name: "Create link" }).click();
  const field = owner.getByRole("dialog").getByLabel("Link", { exact: true });
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  expect(link).toMatch(new RegExp(`^${origin}/s/[\\w-]+$`));
  await owner.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  return link;
}

async function downloaded(page: Page, trigger: Locator): Promise<{ name: string; body: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger.click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return { name: download.suggestedFilename(), body: Buffer.concat(chunks).toString() };
}

test("sharing a file shows the full link once, with Copy and a warning", async () => {
  await owner.goto("/");
  await expect(rowOf("hello-share.txt")).toBeVisible();
  await expect(owner.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(
    ADMIN_NAV,
  );

  const dialog = await openShareDialog("hello-share.txt");
  const expiry = dialog.getByLabel("Link expires");
  await expect(expiry).toBeFocused();
  await expect(expiry).toHaveValue("7");
  await expect(expiry.locator("option")).toHaveText([
    "After 1 day",
    "After 7 days",
    "After 30 days",
    "After 1 year",
    "Never",
  ]);
  await expect(dialog.getByLabel("Password (optional)")).toBeVisible();
  await expect(dialog.getByText("At least 8 characters.", { exact: false })).toBeVisible();
  // Only a folder can be a drop box.
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expectNoViolations(owner);

  await expiry.selectOption("30");
  await dialog.getByRole("button", { name: "Create link" }).click();
  const created = owner.getByRole("dialog", { name: "Your link is ready" });
  await expect(created).toBeVisible();
  const field = created.getByLabel("Link", { exact: true });
  await expect(field).toBeFocused();
  const link = await field.inputValue();
  expect(link).toMatch(new RegExp(`^${origin}/s/[\\w-]+$`));
  await expect(
    created.getByText("This is the only time the link is shown.", { exact: false }),
  ).toBeVisible();
  await expect(created.getByText("It works until", { exact: false })).toBeVisible();
  await expect(created.getByText("People will need the password")).toHaveCount(0);
  await expectNoViolations(owner);

  await created.getByRole("button", { name: "Copy link" }).click();
  await expect(created.getByText("Link copied.")).toBeVisible();
  expect(await owner.evaluate(() => navigator.clipboard.readText())).toBe(link);

  await created.getByRole("button", { name: "Done" }).click();
  await expect(created).toHaveCount(0);
  await expect(owner.getByRole("button", { name: "Actions for hello-share.txt" })).toBeFocused();
  links["hello"] = link;

  // A second dialog starts from scratch: the link is gone for good.
  const again = await openShareDialog("hello-share.txt");
  await expect(again.getByLabel("Link", { exact: true })).toHaveCount(0);
  await owner.keyboard.press("Escape");
  await expect(again).toHaveCount(0);
});

test("the shared links page lists the link without ever showing it again", async () => {
  await owner.getByRole("link", { name: "Shared links" }).click();
  await expect(owner.getByRole("heading", { name: "Shared links", level: 1 })).toBeVisible();
  await expect(owner).toHaveTitle(/^Shared links · Cloud$/);
  const row = rowOf("hello-share.txt");
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell").nth(1)).toHaveText("File");
  // Drop box, password, created, expires: a plain "No" / "No" / a date / a date.
  await expect(row.getByRole("cell").nth(2)).toHaveText("No");
  await expect(row.getByRole("cell").nth(3)).toHaveText("No");
  await expect(row.getByRole("cell").nth(5)).not.toHaveText("Never");
  expect(await owner.content()).not.toContain(tokenOf(links["hello"] ?? ""));
  await expect(
    owner.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]'),
  ).toHaveText("Shared links");
  await expectNoViolations(owner);
});

test("anyone with the link can open and download the file without signing in", async () => {
  const page = await anonContext.newPage();
  await page.goto(links["hello"] ?? "");
  await expect(page.getByRole("heading", { name: "hello-share.txt", level: 1 })).toBeVisible();
  await expect(page.getByText("Size: 20 B")).toBeVisible();
  await expect(page).toHaveTitle(/^Shared link · Cloud$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // No signed-in chrome: no navigation to the owner's files, no logout.
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expectNoViolations(page);

  const file = await downloaded(page, page.getByRole("link", { name: "Download" }));
  expect(file).toEqual({ name: "hello-share.txt", body: "hello from the owner" });

  // The language switcher is there, and works without a session.
  await page.getByLabel("Language").selectOption("pt-PT");
  await expect(page.getByRole("link", { name: "Descarregar" })).toBeVisible();
  await expect(page.getByText("Tamanho: 20 B")).toBeVisible();
  await expect(page).toHaveTitle(/^Ligação partilhada · Cloud$/);
  await expectNoViolations(page);
  await setLocale(anonContext, "en");
  await page.close();
});

test("an image share previews in the page", async () => {
  const link = await apiShare(ids["pixel"] ?? "");
  const page = await anonContext.newPage();
  await page.goto(link);
  const image = page.getByRole("img", { name: "pixel.png" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "Download" })).toBeVisible();
  await expectNoViolations(page);
  await page.close();
});

test("a password share asks for the password, refuses a wrong one and opens with the right one", async () => {
  await owner.goto("/");
  const dialog = await openShareDialog("secret-plans.txt");
  const password = dialog.getByLabel("Password (optional)");
  await password.fill("short");
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Use at least 8 characters, or leave the password empty.",
  );
  await expect(password).toBeFocused();
  await expect(password).toHaveAttribute("aria-invalid", "true");

  await password.fill(SECRET);
  await expect(password).toHaveAttribute("type", "password");
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await dialog.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(
    owner.getByRole("dialog").getByText("People will need the password to open it."),
  ).toBeVisible();
  await owner.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  // The link is not kept anywhere, so check the share through the owner's list of shares.
  const listed = await ownerContext.request.get("/api/shares");
  const { shares } = (await listed.json()) as {
    shares: { fileName: string; hasPassword: boolean }[];
  };
  expect(shares.find((s) => s.fileName === "secret-plans.txt")?.hasPassword).toBe(true);
});

test("the locked page leaks nothing, and the password unlocks it", async () => {
  const lockedLink = await apiShare(ids["secret"] ?? "", { password: SECRET });
  const page = await anonContext.newPage();
  await page.goto(lockedLink);
  await expect(
    page.getByRole("heading", { name: "This link is protected", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("secret-plans.txt")).toHaveCount(0);
  await expectNoViolations(page);

  // The same state in Portuguese.
  await setLocale(anonContext, "pt-PT");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Esta ligação está protegida" })).toBeVisible();
  await expectNoViolations(page);
  await setLocale(anonContext, "en");
  await page.reload();

  // Nothing but the lock is reachable before the password.
  const token = tokenOf(lockedLink);
  const content = await anonContext.request.get(`/api/public/shares/${token}/content`);
  expect(content.status()).toBe(401);

  const field = page.getByLabel("Password", { exact: true });
  await field.fill("not the password");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(formAlert(page)).toHaveText("That password isn't right. Please try again.");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expectNoViolations(page);

  await field.fill(SECRET);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("heading", { name: "secret-plans.txt", level: 1 })).toBeVisible();
  const file = await downloaded(page, page.getByRole("link", { name: "Download" }));
  expect(file).toEqual({ name: "secret-plans.txt", body: "the secret plans" });
  await page.close();
});

test("too many wrong passwords are answered with a wait, even for the right one", async () => {
  const link = await apiShare(ids["secret"] ?? "", { password: SECRET });
  const token = tokenOf(link);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wrong = await anonContext.request.post(`/api/public/shares/${token}/unlock`, {
      headers: { origin },
      data: { password: `wrong password ${attempt}` },
    });
    expect(wrong.status()).toBe(401);
  }
  const page = await anonContext.newPage();
  await page.goto(link);
  await page.getByLabel("Password", { exact: true }).fill(SECRET);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(formAlert(page)).toHaveText(
    "Too many attempts for now. Please wait a few minutes and try again.",
  );
  await expect(page.getByRole("heading", { name: "This link is protected" })).toBeVisible();
  await expectNoViolations(page);
  await page.close();
});

test("a folder share is browsed from the shared folder down, and downloads as a zip", async () => {
  await owner.goto("/");
  const dialog = await openShareDialog("Photos");
  await expect(dialog.getByRole("checkbox", { name: /Let people upload files/ })).not.toBeChecked();
  links["photos"] = await createLink(dialog);

  const page = await anonContext.newPage();
  await page.goto(links["photos"]);
  await expect(page.getByRole("heading", { name: "Photos", level: 1 })).toBeVisible();
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByText("Photos")).toHaveAttribute("aria-current", "page");
  // The owner's own folders above the shared one are not part of the picture.
  await expect(crumbs.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "a.txt" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Trips" })).toBeVisible();
  await expectNoViolations(page);

  const a = await downloaded(page, page.getByRole("link", { name: "Download a.txt" }));
  expect(a).toEqual({ name: "a.txt", body: "file a" });

  await page.getByRole("link", { name: "Trips" }).click();
  await expect(page).toHaveURL(/\?folder=[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Trips", level: 1 })).toBeVisible();
  await expect(crumbs.getByRole("link", { name: "Photos" })).toBeVisible();
  await expect(crumbs.getByText("Trips")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("row").filter({ hasText: "b.txt" })).toBeVisible();
  await expectNoViolations(page);

  const b = await downloaded(page, page.getByRole("link", { name: "Download b.txt" }));
  expect(b).toEqual({ name: "b.txt", body: "file b in trips" });

  // The zip of the folder being looked at: a real archive, not an error page.
  const zipHref =
    (await page.getByRole("link", { name: "Download all (.zip)" }).getAttribute("href")) ?? "";
  expect(zipHref).toContain("/zip?folderId=");
  const zip = await anonContext.request.get(zipHref);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toContain("application/zip");
  const subZip = await zip.body();
  expect(subZip.length).toBeGreaterThan(0);
  expect(subZip.subarray(0, 2).toString()).toBe("PK");
  expect(subZip.includes(Buffer.from("b.txt"))).toBe(true);

  await crumbs.getByRole("link", { name: "Photos" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${tokenOf(links["photos"])}$`));
  const rootZip = await anonContext.request.get(
    (await page.getByRole("link", { name: "Download all (.zip)" }).getAttribute("href")) ?? "",
  );
  expect(rootZip.headers()["content-type"]).toContain("application/zip");
  const rootBytes = await rootZip.body();
  expect(rootBytes.length).toBeGreaterThan(subZip.length);
  expect(rootBytes.includes(Buffer.from("Trips/b.txt"))).toBe(true);

  // Nothing outside the shared folder can be asked for.
  const token = tokenOf(links["photos"]);
  const outside = await anonContext.request.get(
    `/api/public/shares/${token}/folder?folderId=${rootId}`,
  );
  expect(outside.status()).toBe(404);

  // A folder id that is not in the share reads as "not found", with a way back.
  await page.goto(`${links["photos"]}?folder=${rootId}`);
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
  await expectNoViolations(page);

  await setLocale(anonContext, "pt-PT");
  await page.goto(links["photos"]);
  await expect(page.getByRole("link", { name: "Descarregar tudo (.zip)" })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole("link", { name: "Trips" }).click();
  await expect(page.getByRole("heading", { name: "Trips", level: 1 })).toBeVisible();
  await expectNoViolations(page);
  await setLocale(anonContext, "en");
  await page.close();
});

test("a folder share is usable on a 320px screen", async () => {
  const page = await anonContext.newPage();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(links["photos"] ?? "");
  await expect(page.getByRole("heading", { name: "Photos", level: 1 })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "a.txt" })).toBeVisible();
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fits).toBe(true);
  await page.close();
});

test("a drop box takes files from strangers and shows them nothing", async () => {
  await owner.goto("/");
  const dialog = await openShareDialog("Inbox");
  await dialog.getByRole("checkbox", { name: /Let people upload files/ }).check();
  await expectNoViolations(owner);
  links["inbox"] = await createLink(dialog);

  const token = tokenOf(links["inbox"]);
  const page = await anonContext.newPage();
  await page.goto(links["inbox"]);
  await expect(page.getByRole("heading", { name: "Send files to Inbox", level: 1 })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0);
  await expectNoViolations(page);

  const panel = page.getByRole("region", { name: "Uploads" });
  await page.locator('input[type="file"]').setInputFiles({
    name: "visitor.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("from a visitor"),
  });
  const item = panel.getByRole("listitem").filter({ hasText: "visitor.txt" });
  await expect(item).toContainText("Uploaded");
  await expect(panel.getByText("Uploaded 1 file")).toBeVisible();
  await expect(item.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expectNoViolations(page);

  // A name that is taken is kept apart, not overwritten.
  await page.locator('input[type="file"]').setInputFiles({
    name: "visitor.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("a second one"),
  });
  await expect(panel.getByText("Uploaded 2 files")).toBeVisible();

  // The owner finds the files in the folder; the stranger has no way to list or read it.
  const listing = await ownerContext.request.get(`/api/folders/${ids["inbox"]}`);
  const names = ((await listing.json()) as { children: { name: string }[] }).children
    .map((c) => c.name)
    .sort();
  expect(names).toEqual(["visitor (1).txt", "visitor.txt"]);
  await owner.goto(`/folders/${ids["inbox"]}`);
  await expect(rowOf("visitor.txt").first()).toBeVisible();
  for (const path of ["/folder", `/folder?folderId=${ids["inbox"]}`, "/content", "/zip"]) {
    const response = await anonContext.request.get(`/api/public/shares/${token}${path}`);
    expect(response.status(), path).toBe(404);
  }

  // A full owner quota is explained in the drop box's own words.
  await page.route("**/api/public/shares/*/uploads", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 413,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "quota_exceeded" } }),
      });
      return;
    }
    await route.continue();
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "huge.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("does not fit"),
  });
  const huge = panel.getByRole("listitem").filter({ hasText: "huge.bin" });
  await expect(huge).toContainText("These files don't fit: the owner's storage is full.");
  await expect(huge).not.toContainText("your storage");
  await expectNoViolations(page);
  await page.unroute("**/api/public/shares/*/uploads");

  await setLocale(anonContext, "pt-PT");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Enviar ficheiros para Inbox", level: 1 }),
  ).toBeVisible();
  await expectNoViolations(page);
  await setLocale(anonContext, "en");
  await page.close();
});

test("a dropped file is uploaded to the drop box", async () => {
  const page = await anonContext.newPage();
  await page.goto(links["inbox"] ?? "");
  await expect(page.getByRole("heading", { name: "Send files to Inbox" })).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["dropped by a visitor"], "dropped.txt", { type: "text/plain" }));
    return transfer;
  });
  const zone = page.locator(".dropzone");
  await zone.dispatchEvent("dragenter", { dataTransfer });
  await expect(page.getByText("Drop the files to send them")).toBeVisible();
  await zone.dispatchEvent("drop", { dataTransfer });
  await expect(
    page
      .getByRole("region", { name: "Uploads" })
      .getByRole("listitem")
      .filter({ hasText: "dropped.txt" }),
  ).toContainText("Uploaded");
  await page.close();
});

test("the shared links page shows every kind of link and works in Portuguese and at 320px", async () => {
  await owner.goto("/shares");
  await expect(owner.getByRole("heading", { name: "Shared links", level: 1 })).toBeVisible();
  const photos = rowOf("Photos");
  await expect(photos.getByRole("link", { name: "Photos" })).toHaveAttribute(
    "href",
    `/folders/${ids["photos"]}`,
  );
  await expect(photos.getByRole("cell").nth(1)).toHaveText("Folder");
  await expect(photos.getByRole("cell").nth(2)).toHaveText("No");
  const inbox = rowOf("Inbox");
  await expect(inbox.getByRole("cell").nth(2)).toHaveText("Yes");
  const secret = rowOf("secret-plans.txt").first();
  await expect(secret.getByRole("cell").nth(3)).toHaveText("Yes");
  await expectNoViolations(owner);

  await owner.setViewportSize({ width: 320, height: 800 });
  await expect(photos).toBeVisible();
  const fits = await owner.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fits).toBe(true);
  await owner.setViewportSize({ width: 1280, height: 720 });

  await setLocale(ownerContext, "pt-PT");
  await owner.reload();
  await expect(
    owner.getByRole("heading", { name: "Ligações partilhadas", level: 1 }),
  ).toBeVisible();
  await expect(owner.getByRole("columnheader", { name: "Caixa de entrega" })).toBeVisible();
  await expectNoViolations(owner);

  await owner.goto("/");
  await rowOf("Photos").getByRole("button", { name: "Ações para Photos" }).click();
  await owner.getByRole("menuitem", { name: "Partilhar…" }).click();
  const dialog = owner.getByRole("dialog", { name: "Partilhar Photos" });
  await expect(dialog.getByLabel("A ligação expira")).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Mostrar palavra-passe" })).toBeVisible();
  await expectNoViolations(owner);
  await dialog.getByRole("button", { name: "Criar ligação" }).click();
  await expect(owner.getByRole("dialog", { name: "A sua ligação está pronta" })).toBeVisible();
  await expectNoViolations(owner);
  await owner.keyboard.press("Escape");
  await setLocale(ownerContext, "en");
});

test("revoking a link asks first, and the link stops working at once", async () => {
  await owner.goto("/shares");
  const row = rowOf("hello-share.txt");
  await row.getByRole("button", { name: "Revoke the link to hello-share.txt" }).click();
  const confirm = owner.getByRole("dialog", { name: "Revoke this link?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectNoViolations(owner);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Revoke the link to hello-share.txt" }).click();
  await confirm.getByRole("button", { name: "Revoke link" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(owner.getByText("Revoked the link to hello-share.txt")).toBeVisible();
  await expect(row).toHaveCount(0);

  const page = await anonContext.newPage();
  await page.goto(links["hello"] ?? "");
  await expect(
    page.getByRole("heading", { name: "This link doesn't work", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("hello-share.txt")).toHaveCount(0);
  await expectNoViolations(page);
  const content = await anonContext.request.get(
    `/api/public/shares/${tokenOf(links["hello"] ?? "")}/content`,
  );
  expect(content.status()).toBe(404);

  await setLocale(anonContext, "pt-PT");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Esta ligação não funciona" })).toBeVisible();
  await expectNoViolations(page);
  await setLocale(anonContext, "en");

  // A link that never existed looks exactly the same.
  await page.goto(`${origin}/s/not-a-real-token`);
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
  await page.close();
});
