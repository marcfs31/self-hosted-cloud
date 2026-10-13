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
const PICTURES = ["sunrise.png", "forest.png", "ocean.png"] as const;

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

async function setLocale(locale: "en" | "es") {
  await context.addCookies([{ name: "locale", value: locale, url: origin }]);
}

// ---- Fixtures: real PNG bytes made here, so no binary files live in the repo ----------------

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour 32×32 PNG. */
async function png(red: number, green: number, blue: number): Promise<Buffer> {
  const { deflateSync } = await import("node:zlib");
  const size = 32;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x += 1) {
    row[1 + x * 3] = red;
    row[2 + x * 3] = green;
    row[3 + x * 3] = blue;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const panel = () => page.getByRole("region", { name: "Uploads" });

/** A tile's open button; exact, because the upload panel has a "Dismiss <name>" button too. */
function tile(name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

function tiles(): Locator {
  return page.locator(".photo-grid > li");
}

/** The file names of the tiles, in the order shown. */
async function tileNames(): Promise<string[]> {
  return page.locator(".photo-open").evaluateAll((buttons) =>
    buttons.map((button) => {
      const image = button.querySelector("img");
      return image?.alt ?? button.querySelector(".photo-fallback-name")?.textContent ?? "";
    }),
  );
}

function thisMonth(locale: string): string {
  const text = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(),
  );
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

test("three pictures and a text file are uploaded; the timeline shows exactly the pictures", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My files", level: 1 })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([
    { name: PICTURES[0], mimeType: "image/png", buffer: await png(220, 80, 40) },
    { name: PICTURES[1], mimeType: "image/png", buffer: await png(30, 140, 60) },
    { name: PICTURES[2], mimeType: "image/png", buffer: await png(30, 80, 200) },
    { name: "diary.txt", mimeType: "text/plain", buffer: Buffer.from("not a picture") },
  ]);
  await expect(panel().getByText("Uploaded 4 files")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Photos" })
    .click();
  await expect(page.getByRole("heading", { name: "Photos", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/^Photos · Cloud$/);
  await expect(tiles()).toHaveCount(3);
  expect((await tileNames()).sort()).toEqual([...PICTURES].sort());
  await expect(page.locator(".photo-grid").getByText("diary.txt")).toHaveCount(0);
  await expect(page.getByText("3 photos", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: thisMonth("en"), level: 2 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Photos" })).toHaveAttribute("aria-current", "page");

  // The thumbnails really were made and are shown, and nothing asks for the originals.
  await expect
    .poll(() =>
      page
        .locator("img.photo-img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  await expect(page.locator("img.photo-img").first()).toHaveAttribute("loading", "lazy");
  await expectNoViolations();
});

test("the lightbox steps through photos with buttons and arrow keys, and Escape gives the focus back", async () => {
  const order = await tileNames();
  const [first, second, third] = order as [string, string, string];
  await tile(first).click();

  const dialog = page.getByRole("dialog", { name: first });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Previous photo" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(dialog.getByText("1 of 3")).toBeVisible();
  await expect(dialog.getByText(/^Date of upload: /)).toBeVisible();
  await expect(dialog.getByRole("img", { name: first })).toHaveAttribute(
    "src",
    /\/api\/files\/[^/]+\/thumbnail\?size=1024$/,
  );
  await expect(dialog.getByRole("link", { name: "Open original" })).toHaveAttribute(
    "href",
    /\/api\/files\/[^/]+\/content$/,
  );
  await expectNoViolations();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: second })).toBeVisible();
  await expect(page.getByText("2 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Next photo" }).click();
  await expect(page.getByRole("dialog", { name: third })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next photo" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: third })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog", { name: second })).toBeVisible();
  await page.getByRole("button", { name: "Previous photo" }).click();
  await expect(page.getByRole("dialog", { name: first })).toBeVisible();
  await page.keyboard.press("ArrowRight");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tile(second)).toBeFocused();
});

test("photos are selected and added to a new album, then to an existing one", async () => {
  const [first, second, third] = (await tileNames()) as [string, string, string];
  const addButton = page.getByRole("button", { name: "Add to album…" });
  await page.getByRole("button", { name: "Select photos" }).click();
  await expect(addButton).toBeDisabled();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await page.getByRole("checkbox", { name: `Select ${first}` }).check();
  await page.getByRole("checkbox", { name: `Select ${second}` }).check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await expectNoViolations();

  await addButton.click();
  const dialog = page.getByRole("dialog", { name: "Add 2 photos to an album" });
  await expect(dialog.getByText("You don't have any albums yet.")).toBeVisible();
  await dialog.getByRole("button", { name: "Create album and add" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a name for the album.");
  await expect(dialog.getByLabel("Name of a new album")).toBeFocused();
  await dialog.getByLabel("Name of a new album").fill("Holiday");
  await dialog.getByRole("button", { name: "Create album and add" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Added 2 photos to Holiday")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select photos" })).toBeFocused();
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  // The third photo goes into an album that already exists.
  await page.getByRole("button", { name: "Select photos" }).click();
  await page.getByRole("checkbox", { name: `Select ${third}` }).check();
  await addButton.click();
  const again = page.getByRole("dialog", { name: "Add 1 photo to an album" });
  await expect(again.getByRole("button", { name: "Holiday (2 photos)" })).toBeVisible();
  await again.getByRole("button", { name: "Holiday (2 photos)" }).click();
  await expect(again).toHaveCount(0);
  await expect(page.getByText("Added 1 photo to Holiday")).toBeVisible();
});

test("albums are listed with a cover, created, renamed and checked for accessibility in two languages", async () => {
  await page.getByRole("link", { name: "Albums" }).click();
  await expect(page.getByRole("heading", { name: "Albums", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/^Albums · Cloud$/);
  await expect(page.getByRole("link", { name: "Photos" }).first()).toHaveAttribute(
    "aria-current",
    "page",
  );
  const holiday = page.getByRole("link", { name: "Holiday 3 photos" });
  await expect(holiday).toBeVisible();
  await expect(holiday.locator("img")).toHaveJSProperty("complete", true);
  await expect
    .poll(() =>
      holiday.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expectNoViolations();

  await page.getByRole("button", { name: "New album" }).click();
  const create = page.getByRole("dialog", { name: "New album" });
  await create.getByLabel("Album name").fill("Scratch");
  await create.getByRole("button", { name: "Create album" }).click();
  await expect(create).toHaveCount(0);
  await expect(page.getByText("Created the album Scratch")).toBeVisible();
  await expect(page.getByRole("link", { name: "Scratch 0 photos" })).toBeVisible();

  await page.getByRole("button", { name: "Rename Scratch" }).click();
  const rename = page.getByRole("dialog", { name: "Rename Scratch" });
  await expect(rename.getByLabel("Album name")).toHaveValue("Scratch");
  await rename.getByLabel("Album name").fill("Summer");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(rename).toHaveCount(0);
  await expect(page.getByText("Renamed the album to Summer")).toBeVisible();
  await expect(page.getByRole("link", { name: "Summer 0 photos" })).toBeVisible();

  // Deleting asks first, and says the photos stay.
  await page.getByRole("button", { name: "Delete Summer" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this album?" });
  await expect(confirm.getByText("The photos in it stay in your files.")).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Delete album" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("Deleted the album Summer")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Summer/ })).toHaveCount(0);
});

test("an album page shows its photos and opens them in the lightbox, in English and Spanish", async () => {
  await page.getByRole("link", { name: "Holiday 3 photos" }).click();
  await expect(page.getByRole("heading", { name: "Holiday", level: 1 })).toBeVisible();
  await expect(tiles()).toHaveCount(3);
  await expect(page.getByText("3 photos", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "All albums" })).toBeVisible();
  await expectNoViolations();

  await page.locator(".photo-open").first().click();
  const lightbox = page.getByRole("dialog");
  await expect(lightbox.getByRole("button", { name: "Next photo" })).toBeVisible();
  await expectNoViolations();
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);

  await setLocale("es");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Holiday", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Seleccionar fotos" })).toBeVisible();
  await expectNoViolations();
  await page.locator(".photo-open").first().click();
  await expect(lightbox.getByRole("button", { name: "Foto siguiente" })).toBeVisible();
  await expect(lightbox.getByText(/^Fecha de subida: /)).toBeVisible();
  await expectNoViolations();
  await page.keyboard.press("Escape");

  await page.goto("/photos");
  await expect(page.getByRole("heading", { name: "Fotos", level: 1 })).toBeVisible();
  await expect(tiles()).toHaveCount(3);
  await expect(page.getByRole("heading", { name: thisMonth("es"), level: 2 })).toBeVisible();
  await expectNoViolations();
  await page.getByRole("button", { name: "Seleccionar fotos" }).click();
  await expect(page.getByRole("checkbox").first()).toHaveAccessibleName(/^Seleccionar /);
  await expectNoViolations();

  await page.goto("/albums");
  await expect(page.getByRole("heading", { name: "Álbumes", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Holiday 3 fotos" })).toBeVisible();
  await expectNoViolations();
  await setLocale("en");
});

test("a photo is removed from an album, and deleting the album leaves every photo in the files", async () => {
  await page.goto("/albums");
  await page.getByRole("link", { name: "Holiday 3 photos" }).click();
  await expect(tiles()).toHaveCount(3);
  const [gone] = await tileNames();

  await page.getByRole("button", { name: "Select photos" }).click();
  const remove = page.getByRole("button", { name: "Remove from album" });
  await expect(remove).toBeDisabled();
  await page.getByRole("checkbox", { name: `Select ${gone ?? ""}` }).check();
  await remove.click();
  await expect(page.getByText("Removed 1 photo from Holiday")).toBeVisible();
  await expect(tiles()).toHaveCount(2);
  await expect(tile(gone ?? "")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Holiday", level: 1 })).toBeFocused();

  // Renaming from the album page.
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename Holiday" });
  await rename.getByLabel("Album name").fill("Holiday 2026");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("heading", { name: "Holiday 2026", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Delete album" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this album?" });
  await expect(confirm.getByText("The photos in it stay in your files.")).toBeVisible();
  await confirm.getByRole("button", { name: "Delete album" }).click();
  await expect(page).toHaveURL(/\/albums$/);
  await expect(page.getByText("No albums yet")).toBeVisible();

  await page.goto("/photos");
  await expect(tiles()).toHaveCount(3);
  await page.goto("/");
  for (const name of PICTURES) {
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
  }

  // A deleted album is a plain "not found".
  await page.goBack();
  await page.goto("/albums/does-not-exist");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("the photos page fits a 320 px screen without sideways scrolling", async () => {
  await page.setViewportSize({ width: 320, height: 700 });
  async function fits() {
    return page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
  }
  await page.goto("/photos");
  await expect(tiles()).toHaveCount(3);
  expect(await fits()).toBe(true);

  await page.getByRole("button", { name: "Select photos" }).click();
  expect(await fits()).toBe(true);
  await page.getByRole("button", { name: "Cancel selection" }).click();

  await page.locator(".photo-open").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  expect(await fits()).toBe(true);
  const box = await dialog.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  await expectNoViolations();
  await page.keyboard.press("Escape");

  await page.goto("/albums");
  await expect(page.getByRole("heading", { name: "Albums", level: 1 })).toBeVisible();
  expect(await fits()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
});

test("a video gets a Video label and plays in the lightbox with native controls", async () => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "clip.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("not really a movie"),
  });
  await expect(panel().getByText("Uploaded 1 file")).toBeVisible();
  await page.goto("/photos");
  await expect(tiles()).toHaveCount(4);
  const clip = page.getByRole("button", { name: /clip\.mp4/ });
  await expect(clip.getByText("Video", { exact: true })).toBeVisible();
  // These bytes are no movie, so there is no thumbnail: the tile falls back to a file icon.
  await expect(clip.locator(".photo-fallback")).toBeVisible();
  await expectNoViolations();

  await clip.click();
  const dialog = page.getByRole("dialog", { name: "clip.mp4" });
  const video = dialog.locator("video");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("src", /\/api\/files\/[^/]+\/content$/);
  await page.keyboard.press("Escape");
  await expect(clip).toBeFocused();
});

/** Photos that exist only in the browser: a second page of the timeline, to test paging. */
function syntheticPhotos(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const n = from + i;
    return {
      fileId: `synthetic-${String(n)}`,
      name: `photo-${String(n)}.jpg`,
      mime: "image/jpeg",
      kind: "image",
      takenAt: new Date(Date.now() - n * 3_600_000).toISOString(),
      takenAtSource: "exif",
      width: null,
      height: null,
    };
  });
}

test("the timeline loads its next page when the end scrolls into view", async () => {
  const requested: (string | null)[] = [];
  await page.route(
    (url) => url.pathname === "/api/photos",
    async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      requested.push(cursor);
      const body =
        cursor === null
          ? { items: syntheticPhotos(0, 100), nextCursor: "page-2" }
          : { items: syntheticPhotos(100, 20), nextCursor: null };
      await route.fulfill({ json: body });
    },
  );
  await page.goto("/photos");
  await expect(tiles().first()).toBeVisible();
  // Thumbnails of photos that do not exist fall back to a generic tile with the name.
  await expect(tiles().first().locator(".photo-fallback-name")).toHaveText("photo-0.jpg");
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await expect(page.getByText("120 photos", { exact: true })).toBeVisible();
  await expect(tiles()).toHaveCount(120);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  // (The dev server runs effects twice, so the first page may be asked for twice.)
  expect(requested.filter((cursor) => cursor !== null)).toEqual(["page-2"]);
  await page.unroute((url) => url.pathname === "/api/photos");
});

test("with reduced motion nothing loads by itself; Load more does, and a failure can be retried", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let failNext = true;
  await page.route(
    (url) => url.pathname === "/api/photos",
    async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor === null) {
        await route.fulfill({ json: { items: syntheticPhotos(0, 100), nextCursor: "page-2" } });
      } else if (failNext) {
        failNext = false;
        await route.fulfill({ status: 500, json: { error: { code: "internal" } } });
      } else {
        await route.fulfill({ json: { items: syntheticPhotos(100, 20), nextCursor: null } });
      }
    },
  );
  await page.goto("/photos");
  await expect(page.getByText("100 photos so far")).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  const more = page.getByRole("button", { name: "Load more" });
  await expect(more).toBeVisible();
  await expect(tiles()).toHaveCount(100);

  await more.click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "Something went wrong on our side. Please try again in a moment.",
  );
  await expect(tiles()).toHaveCount(100);
  await more.click();
  await expect(page.getByText("120 photos", { exact: true })).toBeVisible();
  await expect(tiles()).toHaveCount(120);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);

  await page.unroute((url) => url.pathname === "/api/photos");
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

test("the lightbox asks for the next page near the end of what is loaded, and stops asking after a failure", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let secondPageRequests = 0;
  let fail = true;
  await page.route(
    (url) => url.pathname === "/api/photos",
    async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor === null) {
        await route.fulfill({ json: { items: syntheticPhotos(0, 100), nextCursor: "page-2" } });
        return;
      }
      secondPageRequests += 1;
      if (fail) {
        await route.fulfill({ status: 500, json: { error: { code: "internal" } } });
      } else {
        await route.fulfill({ json: { items: syntheticPhotos(100, 20), nextCursor: null } });
      }
    },
  );
  await page.goto("/photos");
  await expect(tiles()).toHaveCount(100);
  await tile("photo-99.jpg").click();
  await expect(page.getByRole("dialog", { name: "photo-99.jpg" })).toBeVisible();
  await expect(page.getByText("100 of 100+")).toBeVisible();
  // There is no thumbnail for these, so the lightbox says so instead of showing a broken image.
  await expect(page.getByText("A preview isn't available for this file.")).toBeVisible();
  // The first attempt fails; the lightbox does not keep hammering the server.
  await expect.poll(() => secondPageRequests).toBe(1);
  await page.waitForTimeout(500);
  expect(secondPageRequests).toBe(1);
  await page.keyboard.press("Escape");

  fail = false;
  await page.locator("main").getByRole("button", { name: "Load more" }).click();
  await expect(tiles()).toHaveCount(120);
  await tile("photo-99.jpg").click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "photo-100.jpg" })).toBeVisible();
  await expect(page.getByText("101 of 120")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tile("photo-100.jpg")).toBeFocused();

  await page.unroute((url) => url.pathname === "/api/photos");
  await page.emulateMedia({ reducedMotion: "no-preference" });
});
