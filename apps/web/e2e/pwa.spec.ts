import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
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

function photo(name: string, content: string) {
  return { name, mimeType: "image/jpeg", buffer: Buffer.from(content) };
}

const pick = () => page.getByTestId("backup-pick");
const summary = () => page.locator("p.summary");

test("the web app manifest is valid and its icons load", async () => {
  const response = await context.request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
    share_target: {
      action: string;
      method: string;
      enctype: string;
      params: { files: { name: string; accept: string[] }[] };
    };
  };
  expect(manifest).toMatchObject({
    name: "Cloud",
    short_name: "Cloud",
    start_url: "/",
    display: "standalone",
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { files: [{ name: "files", accept: ["*/*"] }] },
    },
  });
  expect(manifest.icons.some((i) => i.sizes === "192x192" && i.type === "image/png")).toBe(true);
  expect(manifest.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    const loaded = await context.request.get(icon.src);
    expect(loaded.status(), icon.src).toBe(200);
    expect(loaded.headers()["content-type"], icon.src).toContain(icon.type.split("/")[0] ?? "");
  }
  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
});

for (const locale of ["en", "ca"] as const) {
  test(`the offline page is accessible in ${locale}`, async () => {
    await setLocale(locale);
    await page.goto("/offline");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      locale === "en" ? "Cloud can't be reached" : "No es pot accedir a Cloud",
    );
    await expectNoViolations();
  });
}

test("the header links to phone backup", async () => {
  await setLocale("en");
  await page.goto("/");
  await page.getByRole("link", { name: "Phone backup" }).click();
  await expect(page).toHaveURL(/\/backup$/);
  await expect(page.getByRole("heading", { name: "Phone backup", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Phone backup" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("backup uploads new photos and skips the ones the cloud already has", async () => {
  await page.goto("/backup");
  await expect(
    page.getByText(/phones don't allow a web app to back up fully automatically/i),
  ).toBeVisible();

  await pick().setInputFiles([photo("one.jpg", "photo one"), photo("two.jpg", "photo two")]);
  await expect(summary()).toHaveText("0 already backed up, 2 uploaded, 0 failed");

  // The same two photos again: nothing is uploaded a second time.
  await pick().setInputFiles([photo("one.jpg", "photo one"), photo("two.jpg", "photo two")]);
  await expect(summary()).toHaveText("2 already backed up, 0 uploaded, 0 failed");

  // The check is by content: a renamed copy is still a duplicate, a new photo is not.
  await pick().setInputFiles([
    photo("IMG_0001.jpg", "photo one"),
    photo("three.jpg", "photo three"),
  ]);
  await expect(summary()).toHaveText("1 already backed up, 1 uploaded, 0 failed");

  await page.goto("/");
  await page.getByRole("link", { name: "Camera uploads" }).click();
  await expect(page.getByRole("heading", { name: "Camera uploads", level: 1 })).toBeVisible();
  for (const name of ["one.jpg", "two.jpg", "three.jpg"]) {
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
  }
  await expect(page.getByRole("row").filter({ hasText: "IMG_0001.jpg" })).toHaveCount(0);
});

test("the camera button backs up a single photo to the same folder", async () => {
  await page.goto("/backup");
  const camera = page.getByTestId("backup-camera");
  await expect(camera).toHaveAttribute("capture", "environment");
  await expect(camera).toHaveAttribute("accept", "image/*");
  await camera.setInputFiles(photo("snap.jpg", "a fresh snap"));
  await expect(summary()).toHaveText("0 already backed up, 1 uploaded, 0 failed");
  await camera.setInputFiles(photo("snap.jpg", "a fresh snap"));
  await expect(summary()).toHaveText("1 already backed up, 0 uploaded, 0 failed");
});

test("backup can go to another folder, picked from the folder dialog", async () => {
  const root = (await (await context.request.get("/api/files/root")).json()) as {
    folder: { id: string };
  };
  const created = await context.request.post("/api/folders", {
    headers: { origin },
    data: { parentId: root.folder.id, name: "Holiday" },
  });
  expect(created.status()).toBe(201);

  await page.goto("/backup");
  await expect(page.getByText("Backup folder: Camera uploads", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Choose another folder" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose the backup folder" });
  await expect(dialog).toBeVisible();
  await expectNoViolations();
  await dialog.getByRole("button", { name: "Open folder Holiday" }).click();
  await dialog.getByRole("button", { name: "Use this folder" }).click();
  await expect(page.getByText("Backup folder: Holiday")).toBeVisible();

  await pick().setInputFiles(photo("beach.jpg", "beach"));
  await expect(summary()).toHaveText("0 already backed up, 1 uploaded, 0 failed");
  await page.getByRole("button", { name: "Use the default folder" }).click();
  await expect(page.getByText("Backup folder: Camera uploads", { exact: false })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Holiday" }).click();
  await expect(page.getByRole("row").filter({ hasText: "beach.jpg" })).toBeVisible();
});

for (const locale of ["en", "ca"] as const) {
  test(`phone backup is accessible in ${locale}`, async () => {
    await setLocale(locale);
    await page.goto("/backup");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      locale === "en" ? "Phone backup" : "Còpia del mòbil",
    );
    await expectNoViolations();
  });
}

test("phone backup fits a 320px screen without sideways scrolling", async () => {
  await setLocale("en");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/backup");
  await expect(page.getByRole("heading", { name: "Phone backup", level: 1 })).toBeVisible();
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Choose another folder" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });
});

test("the share target page shows a friendly empty state for an unknown share", async () => {
  await setLocale("en");
  for (const url of [
    "/share-target?id=0b9d0c2e-6f0a-4c1e-9d0a-3f4f8f6a1b2c",
    "/share-target?id=not-an-id",
    "/share-target",
  ]) {
    await page.goto(url);
    await expect(page.getByText("Nothing to upload here")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to files" })).toBeVisible();
  }
});

for (const locale of ["en", "ca"] as const) {
  test(`the share target page is accessible in ${locale}`, async () => {
    await setLocale(locale);
    await page.goto("/share-target?id=0b9d0c2e-6f0a-4c1e-9d0a-3f4f8f6a1b2c");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      locale === "en" ? "Shared with Cloud" : "Compartit amb Cloud",
    );
    await expectNoViolations();
  });
}

/** What the service worker stores for a share-sheet POST (see sw/sw.ts), put there by hand. */
async function seedShare(id: string, files: { name: string; content: string }[], ageMs = 0) {
  await page.evaluate(
    async ({ id: shareId, shared, age }) => {
      const cache = await caches.open("cloud-share");
      let index = 0;
      for (const file of shared) {
        await cache.put(
          `/share-target-files/${shareId}/${String(index)}`,
          new Response(file.content, {
            headers: {
              "content-type": "text/plain",
              "x-file-name": encodeURIComponent(file.name),
              "x-shared-at": String(Date.now() - age),
            },
          }),
        );
        index += 1;
      }
    },
    { id, shared: files, age: ageMs },
  );
}

const SHARE_ID = "5f1d6c0e-3b1a-4b7e-8f55-0a4d2f9e7c11";

test("shared files are listed, uploaded to a chosen folder and then forgotten", async () => {
  await setLocale("en");
  await page.goto("/backup");
  await seedShare(SHARE_ID, [
    { name: "notes.txt", content: "shared notes" },
    { name: "list.txt", content: "shared list" },
  ]);

  await page.goto(`/share-target?id=${SHARE_ID}`);
  await expect(page.getByText("2 files ready to upload")).toBeVisible();
  const list = page.getByRole("list", { name: "Shared files" });
  await expect(list.getByText("notes.txt")).toBeVisible();
  await expect(list.getByText("list.txt")).toBeVisible();
  await expect(page.getByText("Upload to: My files")).toBeVisible();
  await expectNoViolations();

  await page.getByRole("button", { name: "Choose another folder" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose where to upload" });
  await dialog.getByRole("button", { name: "Open folder Holiday" }).click();
  await dialog.getByRole("button", { name: "Use this folder" }).click();
  await expect(page.getByText("Upload to: Holiday")).toBeVisible();

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Uploaded 2 files to Holiday.")).toBeVisible();

  const left = await page.evaluate(async () => {
    const cache = await caches.open("cloud-share");
    return (await cache.keys()).length;
  });
  expect(left).toBe(0);

  await page.getByRole("link", { name: "Open the folder" }).click();
  await expect(page.getByRole("heading", { name: "Holiday", level: 1 })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "notes.txt" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "list.txt" })).toBeVisible();

  // Reopening the same share finds nothing any more.
  await page.goto(`/share-target?id=${SHARE_ID}`);
  await expect(page.getByText("Nothing to upload here")).toBeVisible();
});

test("shared files can be discarded", async () => {
  const id = "9a7e2b34-1c5d-4e68-b0f3-6d8a1c4e2f77";
  await page.goto("/backup");
  await seedShare(id, [{ name: "discard-me.txt", content: "x" }]);
  await page.goto(`/share-target?id=${id}`);
  await expect(page.getByText("1 file ready to upload")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("The shared files were discarded.")).toBeVisible();
  const left = await page.evaluate(async () => {
    const cache = await caches.open("cloud-share");
    return (await cache.keys()).length;
  });
  expect(left).toBe(0);
});

test("shared files nobody uploaded are forgotten after a day, when the page opens", async () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const stale = "3c2f8a10-7d4e-4b19-a6c5-1e9b0d7f4a22";
  const other = "7e4b1d93-2a6c-4f08-8b3d-5c9a1e0f6b44";
  const fresh = "d1a5c7e2-9b3f-4a60-8e17-2f4c6b8d0a93";
  await page.goto("/backup");
  await seedShare(stale, [{ name: "stale.txt", content: "old" }], DAY_MS + 60_000);
  await seedShare(other, [{ name: "other.txt", content: "old" }], 3 * DAY_MS);
  await seedShare(fresh, [{ name: "fresh.txt", content: "new" }], DAY_MS - 60_000);

  // Opening an old share finds nothing, and opening any share clears the other old ones.
  await page.goto(`/share-target?id=${stale}`);
  await expect(page.getByText("Nothing to upload here")).toBeVisible();
  const kept = await page.evaluate(async () => {
    const cache = await caches.open("cloud-share");
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(kept).toEqual([`/share-target-files/${fresh}/0`]);

  await page.goto(`/share-target?id=${fresh}`);
  await expect(page.getByText("1 file ready to upload")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
});

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("iPhone Safari gets an install hint that stays dismissed", async ({ browser }) => {
  const ios = await browser.newContext({ baseURL: origin, userAgent: IPHONE_SAFARI });
  try {
    const iosPage = await ios.newPage();
    await iosPage.goto("/login");
    const hint = iosPage.getByRole("region", { name: "Install the app" });
    await expect(hint).toContainText("Add to Home Screen");
    await hint.getByRole("button", { name: "Got it" }).click();
    await expect(hint).toHaveCount(0);
    await iosPage.reload();
    await expect(iosPage.getByRole("heading", { name: "Log in" })).toBeVisible();
    await expect(iosPage.getByRole("region", { name: "Install the app" })).toHaveCount(0);
  } finally {
    await ios.close();
  }
});

/**
 * What Chromium does when the app becomes installable. The event is only heard once React has
 * hydrated the page (the server-rendered HTML shows before that), so wait for that first.
 */
async function fireInstallPrompt(target: Page) {
  await target.waitForFunction(() =>
    Array.from(document.body.querySelectorAll("*")).some((element) =>
      Object.keys(element).some((key) => key.startsWith("__reactFiber")),
    ),
  );
  await target.evaluate(() => {
    window.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: () => {
          (window as unknown as { prompted: boolean }).prompted = true;
          return Promise.resolve();
        },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      }),
    );
  });
}

test("other browsers see no iOS hint, and Chromium's install prompt becomes a button", async ({
  browser,
}) => {
  const fresh = await browser.newContext({ baseURL: origin });
  try {
    const freshPage = await fresh.newPage();
    const install = freshPage.getByRole("button", { name: "Install app" });
    await freshPage.goto("/login");
    await expect(freshPage.getByRole("heading", { name: "Log in" })).toBeVisible();
    await expect(freshPage.getByText("Add to Home Screen")).toHaveCount(0);
    await expect(install).toHaveCount(0);

    await fireInstallPrompt(freshPage);
    await install.click();
    expect(
      await freshPage.evaluate(() => (window as unknown as { prompted?: boolean }).prompted),
    ).toBe(true);
    await expect(install).toHaveCount(0);

    // "Not now" is remembered: after a reload the prompt no longer shows a button.
    await freshPage.reload();
    await fireInstallPrompt(freshPage);
    await freshPage.getByRole("button", { name: "Not now" }).click();
    await freshPage.reload();
    await expect(freshPage.getByRole("heading", { name: "Log in" })).toBeVisible();
    await fireInstallPrompt(freshPage);
    await expect(install).toHaveCount(0);
  } finally {
    await fresh.close();
  }
});
