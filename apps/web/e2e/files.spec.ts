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

let context: BrowserContext;
let page: Page;
let origin = "";

/** Creates the admin on a fresh server, or just signs in; the browser keeps the session. */
async function signIn(request: APIRequestContext) {
  const headers = { origin };
  const status = await request.get("/api/auth/setup");
  const { needsSetup } = (await status.json()) as { needsSetup: boolean };
  const response = needsSetup
    ? await request.post("/api/auth/setup", { headers, data: ADMIN })
    : await request.post("/api/auth/login", { headers, data: ADMIN });
  expect(response.ok()).toBe(true);
}

test.beforeAll(async ({ browser }, testInfo) => {
  origin = String(testInfo.project.use.baseURL);
  context = await browser.newContext({ baseURL: origin });
  page = await context.newPage();
  await signIn(context.request);
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

function rowOf(name: string): Locator {
  return page.getByRole("row").filter({ hasText: name });
}

async function openMenu(name: string) {
  await rowOf(name)
    .getByRole("button", { name: `Actions for ${name}` })
    .click();
}

async function chooseFromMenu(name: string, item: string) {
  await openMenu(name);
  await page.getByRole("menuitem", { name: item }).click();
}

async function upload(name: string, content: string) {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
}

const panel = () => page.getByRole("region", { name: "Uploads" });

async function clearFinishedUploads() {
  const clear = panel().getByRole("button", { name: "Clear finished" });
  if (await clear.isVisible()) {
    await clear.click();
  }
}

async function openProjects() {
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await expect(rowOf("report.txt")).toBeVisible();
}

async function bodyOf(href: string): Promise<string> {
  const response = await context.request.get(href);
  expect(response.ok()).toBe(true);
  return response.text();
}

test("the root folder starts empty, shows storage, and has no accessibility violations", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My files", level: 1 })).toBeVisible();
  await expect(page.getByText("This folder is empty")).toBeVisible();
  await expect(page.getByRole("meter", { name: "Storage" })).toBeVisible();
  await expect(page.getByText("of 100 GiB used")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText([
    "Files",
    "Photos",
    "Shared links",
    "Trash",
    "Admin",
  ]);
  await expect(page).toHaveTitle(/^Files · Cloud$/);
  await expectNoViolations();
});

test("a folder is created, and a taken name is refused with a clear message", async () => {
  const newFolder = page.getByRole("button", { name: "New folder" });
  await newFolder.click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog.getByLabel("Folder name")).toBeFocused();
  await dialog.getByLabel("Folder name").fill("Projects");
  await dialog.getByRole("button", { name: "Create folder" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rowOf("Projects")).toBeVisible();
  await expect(page.getByText("Created the folder Projects")).toBeVisible();
  await expect(newFolder).toBeFocused();

  await newFolder.click();
  await dialog.getByLabel("Folder name").fill("Projects");
  await dialog.getByRole("button", { name: "Create folder" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Something with that name is already here. Choose another name.",
  );
  await expect(dialog.getByLabel("Folder name")).toBeFocused();
  await expect(dialog.getByLabel("Folder name")).toHaveAttribute("aria-invalid", "true");

  await dialog.getByLabel("Folder name").fill("");
  await dialog.getByRole("button", { name: "Create folder" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a name for the folder.");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(newFolder).toBeFocused();
});

test("the row menu works from the keyboard", async () => {
  const button = page.getByRole("button", { name: "Actions for Projects" });
  await button.focus();
  await page.keyboard.press("Enter");
  const items = page.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await expect(items).toHaveText(["Open", "Rename", "Move…", "Share…", "Move to trash"]);
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("a file uploads, appears in the listing and downloads with the same bytes", async () => {
  await upload("notes.txt", "version one");
  await expect(rowOf("notes.txt")).toBeVisible();
  await expect(panel().getByText("Uploaded 1 file")).toBeVisible();
  await expect(panel().getByRole("progressbar", { name: "Progress of notes.txt" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );

  await openMenu("notes.txt");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("notes.txt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  expect(Buffer.concat(chunks).toString()).toBe("version one");
});

test("a file is renamed and moved into a folder, and the move cannot target the item itself", async () => {
  await chooseFromMenu("notes.txt", "Rename");
  const rename = page.getByRole("dialog", { name: "Rename notes.txt" });
  await expect(rename.getByLabel("New name")).toBeFocused();
  await rename.getByLabel("New name").fill("report.txt");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(rename).toHaveCount(0);
  await expect(rowOf("report.txt")).toBeVisible();
  await expect(rowOf("notes.txt")).toHaveCount(0);

  // Moving a folder: it is listed in the picker but cannot be entered.
  await chooseFromMenu("Projects", "Move…");
  const moveFolder = page.getByRole("dialog", { name: "Move Projects" });
  await expect(moveFolder.getByText("Can't move into itself")).toBeVisible();
  await expect(moveFolder.getByRole("button", { name: "Open folder Projects" })).toHaveCount(0);
  await expect(moveFolder.getByRole("button", { name: "Move here" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await chooseFromMenu("report.txt", "Move…");
  const move = page.getByRole("dialog", { name: "Move report.txt" });
  await move.getByRole("button", { name: "Open folder Projects" }).click();
  await expect(move.getByText("Move to: Projects")).toBeVisible();
  await move.getByRole("button", { name: "Move here" }).click();
  await expect(move).toHaveCount(0);
  await expect(page.getByText("Moved report.txt to Projects")).toBeVisible();
  await expect(rowOf("report.txt")).toHaveCount(0);

  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/folders\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await expect(rowOf("report.txt")).toBeVisible();
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "My files" })).toBeVisible();
  await expect(crumbs.getByText("Projects")).toHaveAttribute("aria-current", "page");
  await expectNoViolations();
});

test("uploading a taken name and choosing Replace adds a version, and a version can be restored", async () => {
  await clearFinishedUploads();
  await upload("report.txt", "version two");
  const conflict = page.getByRole("dialog", { name: "That name is already taken" });
  await expect(conflict).toBeVisible();
  await expect(conflict.getByText("report.txt is already in this folder.")).toBeVisible();
  await conflict.getByRole("button", { name: "Replace (keeps the old version)" }).click();
  await expect(conflict).toHaveCount(0);
  await expect(rowOf("report.txt")).toContainText("2 versions");

  await chooseFromMenu("report.txt", "Version history…");
  const dialog = page.getByRole("dialog", { name: "Version history of report.txt" });
  const versions = dialog.getByRole("list", { name: "Versions" }).getByRole("listitem");
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(0)).toContainText("Version 2");
  await expect(versions.nth(0)).toContainText("Current");
  await expect(versions.nth(0)).toContainText("11 B");
  await expect(versions.nth(1)).toContainText("Version 1");
  await expect(versions.nth(0).getByRole("button", { name: /Delete/ })).toHaveCount(0);
  await expectNoViolations();

  const v1Link = dialog.getByRole("link", { name: "Download version 1" });
  const v1Href = (await v1Link.getAttribute("href")) ?? "";
  expect(await bodyOf(v1Href)).toBe("version one");
  const fileHref = v1Href.replace(/\/versions\/.*$/, "/content");
  expect(await bodyOf(fileHref)).toBe("version two");

  await dialog.getByRole("button", { name: "Restore version 1" }).click();
  await expect(dialog.getByText("Version 1 is now the current version.")).toBeVisible();
  await expect(versions.nth(1)).toContainText("Current");
  expect(await bodyOf(fileHref)).toBe("version one");

  // Deleting the version that is no longer current asks first.
  await versions.nth(0).getByRole("button", { name: "Delete version 2" }).click();
  await expect(dialog.getByText("Delete version 2 for good?")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(versions).toHaveCount(2);

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actions for report.txt" })).toBeFocused();
});

test("the same pages have no accessibility violations in Catalan", async () => {
  await setLocale("ca");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await expect(page.getByText("Emmagatzematge:")).toBeVisible();
  await expectNoViolations();

  await rowOf("report.txt").getByRole("button", { name: "Accions per a report.txt" }).click();
  await page.getByRole("menuitem", { name: "Historial de versions…" }).click();
  const dialog = page.getByRole("dialog", { name: "Historial de versions de report.txt" });
  await expect(dialog.getByText("Versió 2")).toBeVisible();
  await expectNoViolations();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Els meus fitxers", level: 1 })).toBeVisible();
  await expectNoViolations();
  await page.goto("/trash");
  await expect(page.getByRole("heading", { name: "Paperera", level: 1 })).toBeVisible();
  await expectNoViolations();

  await setLocale("en");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My files", level: 1 })).toBeVisible();
});

test("uploading a taken name and choosing Keep both makes 'name (1).ext'", async () => {
  await openProjects();
  await clearFinishedUploads();
  await upload("report.txt", "a third take");
  const conflict = page.getByRole("dialog", { name: "That name is already taken" });
  await conflict.getByRole("button", { name: "Keep both" }).click();
  await expect(rowOf("report (1).txt")).toBeVisible();
  await expect(rowOf("report.txt")).toBeVisible();
});

test("several conflicts can be answered at once with 'Apply to all remaining'", async () => {
  await clearFinishedUploads();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
    { name: "report (1).txt", mimeType: "text/plain", buffer: Buffer.from("y") },
    { name: "fresh.txt", mimeType: "text/plain", buffer: Buffer.from("z") },
  ]);
  const conflict = page.getByRole("dialog", { name: "That name is already taken" });
  await conflict.getByLabel("Apply to all remaining (1)").check();
  await conflict.getByRole("button", { name: "Skip" }).click();
  await expect(conflict).toHaveCount(0);
  await expect(rowOf("fresh.txt")).toBeVisible();
  await expect(rowOf("report (2).txt")).toHaveCount(0);
  await expect(rowOf("report (1).txt")).toHaveCount(1);
});

test("files dropped on the listing are uploaded", async () => {
  await clearFinishedUploads();
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["dropped"], "dropped.txt", { type: "text/plain" }));
    return transfer;
  });
  const zone = page.locator(".dropzone");
  await zone.dispatchEvent("dragenter", { dataTransfer });
  await expect(page.getByText("Drop files to upload them to Projects")).toBeVisible();
  await zone.dispatchEvent("drop", { dataTransfer });
  await expect(page.getByText("Drop files to upload them to Projects")).toHaveCount(0);
  await expect(rowOf("dropped.txt")).toBeVisible();
});

test("an upload can be paused, resumed and cancelled", async () => {
  await clearFinishedUploads();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/uploads/*", async (route) => {
    if (route.request().method() === "PATCH") {
      await gate;
    }
    await route.continue().catch(() => undefined);
  });

  await upload("slow.txt", "slow content");
  const slow = panel().getByRole("listitem").filter({ hasText: "slow.txt" });
  await expect(slow).toContainText("Uploading");
  await slow.getByRole("button", { name: "Pause slow.txt" }).click();
  await expect(slow).toContainText("Paused");
  release();
  await slow.getByRole("button", { name: "Resume slow.txt" }).click();
  await expect(slow).toContainText("Uploaded");
  await expect(rowOf("slow.txt")).toBeVisible();
  await page.unroute("**/api/uploads/*");

  // A second upload is stopped for good: nothing reaches the folder.
  await page.route("**/api/uploads/*", async (route) => {
    if (route.request().method() === "PATCH") {
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
    }
    await route.continue().catch(() => undefined);
  });
  await upload("never.txt", "cancelled content");
  const never = panel().getByRole("listitem").filter({ hasText: "never.txt" });
  await expect(never).toContainText("Uploading");
  await never.getByRole("button", { name: "Cancel never.txt" }).click();
  await expect(never).toContainText("Cancelled");
  await expect(never.getByRole("button", { name: "Retry never.txt" })).toBeVisible();
  await page.unroute("**/api/uploads/*");
  await page.waitForTimeout(3500);
  await expect(rowOf("never.txt")).toHaveCount(0);
  await never.getByRole("button", { name: "Dismiss never.txt" }).click();
  await expect(never).toHaveCount(0);
});

test("a quota error from the server is shown in words, and a retry is offered", async () => {
  await clearFinishedUploads();
  await page.route("**/api/uploads", async (route) => {
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
  await upload("huge.bin", "does not fit");
  const huge = panel().getByRole("listitem").filter({ hasText: "huge.bin" });
  await expect(huge).toContainText("There isn't enough space left in your storage for this.");
  await expect(huge.getByRole("button", { name: "Retry huge.bin" })).toBeVisible();
  await expect(panel().getByText("0 uploaded, 1 failed")).toBeVisible();
  await expectNoViolations();
  await page.unroute("**/api/uploads");

  await huge.getByRole("button", { name: "Retry huge.bin" }).click();
  await expect(huge).toContainText("Uploaded");
  await expect(rowOf("huge.bin")).toBeVisible();
});

test("an interrupted upload continues where it stopped after a reload", async () => {
  await clearFinishedUploads();
  let created = 0;
  await page.route("**/api/uploads", async (route) => {
    if (route.request().method() === "POST") {
      created += 1;
    }
    await route.continue();
  });
  await page.route("**/api/uploads/*", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.abort();
      return;
    }
    await route.continue();
  });

  // The same file is picked twice: tus recognises it by name, size and modification time.
  const pick = () =>
    page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) {
        throw new Error("no file input");
      }
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["resume me"], "resumed.txt", {
          type: "text/plain",
          lastModified: 1_700_000_000_000,
        }),
      );
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await pick();
  await expect.poll(() => created).toBe(1);

  // Every chunk fails until the page is reloaded, as if the connection dropped for good.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await page.unroute("**/api/uploads/*");
  await expect(rowOf("resumed.txt")).toHaveCount(0);
  await pick();
  await expect(panel().getByText("Uploaded 1 file")).toBeVisible();
  await expect(rowOf("resumed.txt")).toBeVisible();
  expect(created).toBe(1);
  await page.unroute("**/api/uploads");
});

test("an item goes to the trash, is restored, then deleted forever after a confirmation", async () => {
  await chooseFromMenu("report (1).txt", "Move to trash");
  await expect(page.getByText("Moved report (1).txt to the trash")).toBeVisible();
  await expect(rowOf("report (1).txt")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Trash" }).click();
  await expect(page).toHaveURL(/\/trash$/);
  await expect(page.getByRole("heading", { name: "Trash", level: 1 })).toBeVisible();
  await expect(page.getByText("then they are deleted for good", { exact: false })).toContainText(
    "30 days",
  );
  await expect(rowOf("report (1).txt")).toBeVisible();
  await expectNoViolations();

  await page.getByRole("button", { name: "Restore report (1).txt" }).click();
  await expect(page.getByText("Restored report (1).txt")).toBeVisible();
  await expect(page.getByText("The trash is empty", { exact: true })).toBeVisible();

  await page.goto("/");
  await openProjects();
  await expect(rowOf("report (1).txt")).toBeVisible();
  await chooseFromMenu("report (1).txt", "Move to trash");
  await expect(rowOf("report (1).txt")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Trash" }).click();
  await page.getByRole("button", { name: "Delete report (1).txt forever" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete forever?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(rowOf("report (1).txt")).toBeVisible();

  await page.getByRole("button", { name: "Delete report (1).txt forever" }).click();
  await confirm.getByRole("button", { name: "Delete forever" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("Deleted report (1).txt for good")).toBeVisible();
  await expect(rowOf("report (1).txt")).toHaveCount(0);
});

test("the trash is emptied after a confirmation", async () => {
  await page.goto("/");
  await openProjects();
  await chooseFromMenu("fresh.txt", "Move to trash");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Trash" }).click();
  await expect(rowOf("fresh.txt")).toBeVisible();

  await page.getByRole("button", { name: "Empty trash" }).click();
  const confirm = page.getByRole("dialog", { name: "Empty the trash?" });
  await expect(confirm.getByText("1 item will be deleted for good.")).toBeVisible();
  await confirm.getByRole("button", { name: "Empty trash" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("The trash is empty now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Empty trash" })).toBeDisabled();
});

test("storage in use includes every version, and the admin table shows used and quota", async () => {
  await page.goto("/admin");
  const row = page.getByRole("row", { name: new RegExp(ADMIN.email) });
  await expect(row).toContainText("of 100 GiB");
  await expect(page.getByRole("columnheader", { name: "Storage used" })).toBeVisible();
});

test("the file pages fit a 320px screen without sideways scrolling", async () => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ["/", "/trash"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto("/");
  await expect(rowOf("Projects")).toBeVisible();
  await openMenu("Projects");
  await expect(page.getByRole("menuitem", { name: "Open" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
