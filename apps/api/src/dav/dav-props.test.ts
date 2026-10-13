import { describe, expect, it } from "vitest";
import { davProperties } from "../db/schema/index.js";
import { bodyText, davSetup as setup, parseMultistatus, type DavClient } from "../testing/dav.js";
import {
  MAX_PROPERTIES_PER_RESOURCE,
  MAX_PROPERTY_BYTES,
  MAX_PROPERTY_TOTAL_BYTES,
} from "./properties.js";

const patch = (...actions: string[]) =>
  `<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:z" xmlns:Q="urn:q">${actions.join("")}</D:propertyupdate>`;
const set = (inner: string) => `<D:set><D:prop>${inner}</D:prop></D:set>`;
const remove = (inner: string) => `<D:remove><D:prop>${inner}</D:prop></D:remove>`;
const propfind = (kind: string) =>
  `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:Z="urn:z" xmlns:Q="urn:q">${kind}</D:propfind>`;
const named = (...names: string[]) => propfind(`<D:prop>${names.join("")}</D:prop>`);

async function patched(da: DavClient, path: string, body: string) {
  const text = await bodyText(da.proppatch(path, body));
  const [entry] = parseMultistatus(text);
  if (!entry) throw new Error("no response element");
  return entry;
}

async function found(da: DavClient, path: string, body: string, depth = "0") {
  return parseMultistatus(await bodyText(da.propfind(path, depth, body)));
}

describe("WebDAV: PROPPATCH dead properties", () => {
  it("stores, replaces and removes a property; PROPFIND finds it by name, propname and allprop", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");

    const first = await patched(da, "/dav/a.txt", patch(set("<Z:color>blue</Z:color>")));
    expect([...(first.props.get(200)?.keys() ?? [])]).toEqual(["color"]);
    expect(first.props.get(200)?.get("color")?.text).toBe("");

    const [byName] = await found(da, "/dav/a.txt", named("<Z:color/>", "<Z:other/>"));
    expect(byName?.props.get(200)?.get("color")).toMatchObject({ ns: "urn:z", text: "blue" });
    expect([...(byName?.props.get(404)?.keys() ?? [])]).toEqual(["other"]);

    const [names] = await found(da, "/dav/a.txt", propfind("<D:propname/>"));
    expect(names?.props.get(200)?.get("color")).toMatchObject({ ns: "urn:z", text: "" });
    const [all] = await found(da, "/dav/a.txt", propfind("<D:allprop/>"));
    expect(all?.props.get(200)?.get("color")?.text).toBe("blue");
    expect(all?.props.get(200)?.has("getetag")).toBe(true);

    await patched(da, "/dav/a.txt", patch(set("<Z:color>red</Z:color>")));
    const [replaced] = await found(da, "/dav/a.txt", named("<Z:color/>"));
    expect(replaced?.props.get(200)?.get("color")?.text).toBe("red");

    const gone = await patched(da, "/dav/a.txt", patch(remove("<Z:color/>")));
    expect([...(gone.props.get(200)?.keys() ?? [])]).toEqual(["color"]);
    const [after] = await found(da, "/dav/a.txt", named("<Z:color/>"));
    expect(after?.props.get(404)?.has("color")).toBe(true);
    const again = await patched(da, "/dav/a.txt", patch(remove("<Z:color/>")));
    expect(again.props.get(200)?.has("color")).toBe(true);
  });

  it("applies set and remove in document order", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    await patched(
      da,
      "/dav/a.txt",
      patch(set("<Z:p>1</Z:p>"), remove("<Z:p/>"), set("<Z:q>1</Z:q>"), remove("<Z:q/>")),
    );
    await patched(da, "/dav/a.txt", patch(remove("<Z:r/>"), set("<Z:r>1</Z:r>")));
    const [entry] = await found(da, "/dav/a.txt", named("<Z:p/>", "<Z:q/>", "<Z:r/>"));
    expect([...(entry?.props.get(200)?.keys() ?? [])]).toEqual(["r"]);
    expect([...(entry?.props.get(404)?.keys() ?? [])]).toEqual(["p", "q"]);
  });

  it("returns a value with its markup, namespaces, language and null namespace intact", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const body =
      '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:z" xmlns:Q="urn:q" xmlns="urn:default"><D:set><D:prop>' +
      '<Z:rich xml:lang="pt">a &amp; b<Q:child k="v">c</Q:child><plain/><![CDATA[<raw>]]></Z:rich>' +
      "<defaulted>d</defaulted>" +
      '<bare xmlns="">e</bare>' +
      '<Z:wide xmlns:Z="urn:other">f</Z:wide>' +
      "</D:prop></D:set></D:propertyupdate>";
    const entry = await patched(da, "/dav/a.txt", body);
    expect(entry.props.get(200)?.size).toBe(4);

    const [all] = await found(da, "/dav/a.txt", propfind("<D:allprop/>"));
    const props = all?.props.get(200);
    const rich = props?.get("rich");
    expect(rich?.ns).toBe("urn:z");
    expect(rich?.text).toBe("a & b<raw>");
    expect(rich?.children.map((c) => [c.ns, c.name, c.text])).toEqual([
      ["urn:q", "child", "c"],
      ["urn:default", "plain", ""],
    ]);
    expect(rich?.source).toContain('xml:lang="pt"');
    expect(props?.get("defaulted")).toMatchObject({ ns: "urn:default", text: "d" });
    expect(props?.get("bare")).toMatchObject({ ns: "", text: "e" });
    expect(props?.get("wide")).toMatchObject({ ns: "urn:other", text: "f" });
  });

  it("is all or nothing: a protected property fails with 403 and the rest with 424", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const entry = await patched(
      da,
      "/dav/a.txt",
      patch(
        set("<Z:fine>1</Z:fine>"),
        set("<D:getetag>x</D:getetag>"),
        remove("<D:displayname/>"),
        set("<Z:also>2</Z:also>"),
      ),
    );
    expect([...(entry.props.get(403)?.keys() ?? [])]).toEqual(["getetag", "displayname"]);
    expect([...(entry.props.get(424)?.keys() ?? [])]).toEqual(["fine", "also"]);
    expect(entry.props.has(200)).toBe(false);
    const [stored] = await found(da, "/dav/a.txt", named("<Z:fine/>", "<Z:also/>"));
    expect(stored?.props.has(200)).toBe(false);
  });

  it("answers 403 with the protected-property error element", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const text = await bodyText(da.proppatch("/dav/a.txt", patch(set("<D:getetag>x</D:getetag>"))));
    expect(text).toContain("<D:cannot-modify-protected-property/>");
    expect(text).toContain("HTTP/1.1 403 Forbidden");
  });

  it("holds properties on folders too, and lists them with the folder's members", async () => {
    const { da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.put("/dav/Dir/in.txt", "x");
    await patched(da, "/dav/Dir/", patch(set("<Z:p>folder</Z:p>")));
    await patched(da, "/dav/Dir/in.txt", patch(set("<Z:p>file</Z:p>")));
    const entries = await found(da, "/dav/Dir/", named("<Z:p/>"), "1");
    expect(entries.map((e) => [e.href, e.props.get(200)?.get("p")?.text])).toEqual([
      ["/dav/Dir/", "folder"],
      ["/dav/Dir/in.txt", "file"],
    ]);
  });

  it("rejects a malformed or ambiguous update with 400 and stores nothing", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const bad = [
      set('<Z:p k="1" k="2">v</Z:p>'),
      set('<Z:p xmlns:Q="">v</Z:p>'),
      set("<Z:p>v\u0001</Z:p>"),
      set("<Z:p><X:undeclared/></Z:p>"),
    ];
    for (const action of bad) {
      expect((await da.proppatch("/dav/a.txt", patch(action))).status, action).toBe(400);
    }
    const [entry] = await found(da, "/dav/a.txt", named("<Z:p/>"));
    expect(entry?.props.has(200)).toBe(false);
  });

  it("accepts the properties file managers send, and answers 404 and 400 where due", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const win =
      '<Win32LastModifiedTime xmlns="urn:schemas-microsoft-com:">Mon, 01 Jan 2024 00:00:00 GMT</Win32LastModifiedTime>';
    const entry = await patched(da, "/dav/a.txt", patch(set(win)));
    expect([...(entry.props.get(200)?.keys() ?? [])]).toEqual(["Win32LastModifiedTime"]);
    expect((await da.proppatch("/dav/missing", patch(set(win)))).status).toBe(404);
    expect((await da.proppatch("/dav/a.txt", "<garbage")).status).toBe(400);
    expect((await da.proppatch("/dav/a.txt", "<other xmlns='DAV:'/>")).status).toBe(400);
  });

  it("keeps properties per user: another user's file of the same name is untouched", async () => {
    const { da, dbb } = await setup();
    await da.put("/dav/a.txt", "x");
    await dbb.put("/dav/a.txt", "y");
    await patched(da, "/dav/a.txt", patch(set("<Z:p>mine</Z:p>")));
    const [theirs] = await found(dbb, "/dav/a.txt", named("<Z:p/>"));
    expect(theirs?.props.has(200)).toBe(false);
    await patched(dbb, "/dav/a.txt", patch(remove("<Z:p/>")));
    const [mine] = await found(da, "/dav/a.txt", named("<Z:p/>"));
    expect(mine?.props.get(200)?.get("p")?.text).toBe("mine");
  });
});

describe("WebDAV: dead property limits", () => {
  const fill = (name: string, bytes: number) => `<Z:${name}>${"x".repeat(bytes)}</Z:${name}>`;

  it("refuses the property that would be number 101 with 507 and applies nothing", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const names = Array.from({ length: MAX_PROPERTIES_PER_RESOURCE }, (_, i) => `p${i}`);
    const full = await patched(
      da,
      "/dav/a.txt",
      patch(set(names.map((n) => `<Z:${n}/>`).join(""))),
    );
    expect(full.props.get(200)?.size).toBe(MAX_PROPERTIES_PER_RESOURCE);

    const over = await patched(da, "/dav/a.txt", patch(set("<Z:p0>again</Z:p0><Z:extra/>")));
    expect([...(over.props.get(507)?.keys() ?? [])]).toEqual(["extra"]);
    expect([...(over.props.get(424)?.keys() ?? [])]).toEqual(["p0"]);
    const [p0] = await found(da, "/dav/a.txt", named("<Z:p0/>", "<Z:extra/>"));
    expect(p0?.props.get(200)?.get("p0")?.text).toBe("");
    expect(p0?.props.has(200)).toBe(true);
    expect(p0?.props.get(404)?.has("extra")).toBe(true);

    const swap = await patched(da, "/dav/a.txt", patch(remove("<Z:p1/>"), set("<Z:extra/>")));
    expect(swap.props.get(200)?.size).toBe(2);
  });

  it("refuses a value over the per-property limit", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const ok = await patched(
      da,
      "/dav/a.txt",
      patch(
        set(fill("fits", MAX_PROPERTY_BYTES - '<Z:fits xmlns:Z="urn:z"></Z:fits>'.length - 40)),
      ),
    );
    expect(ok.props.get(200)?.has("fits")).toBe(true);
    const big = await patched(da, "/dav/a.txt", patch(set(fill("big", MAX_PROPERTY_BYTES))));
    expect(big.props.get(507)?.has("big")).toBe(true);
  });

  it("refuses what would take one resource past its total", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const each = 15_000;
    const per = Math.floor(MAX_PROPERTY_TOTAL_BYTES / (each + 100));
    for (let i = 0; i < per; i += 4) {
      const names = [0, 1, 2, 3].filter((n) => i + n < per).map((n) => `t${i + n}`);
      const res = await patched(
        da,
        "/dav/a.txt",
        patch(set(names.map((n) => fill(n, each)).join(""))),
      );
      expect(res.props.get(200)?.size).toBe(names.length);
    }
    const over = await patched(
      da,
      "/dav/a.txt",
      patch(set(fill("tooMuch", each) + fill("small", 10))),
    );
    expect([...(over.props.get(507)?.keys() ?? [])]).toEqual(["tooMuch"]);
    expect([...(over.props.get(424)?.keys() ?? [])]).toEqual(["small"]);
    const smaller = await patched(da, "/dav/a.txt", patch(set(fill("t0", 10))));
    expect(smaller.props.get(200)?.has("t0")).toBe(true);
  });
});

describe("WebDAV: dead properties follow the resource", () => {
  async function withProps(da: DavClient, path: string, value: string) {
    await patched(da, path, patch(set(`<Z:p>${value}</Z:p>`)));
  }
  const valueAt = async (da: DavClient, path: string) =>
    (await found(da, path, named("<Z:p/>")))[0]?.props.get(200)?.get("p")?.text;

  it("COPY gives the copy the properties; later changes to either do not affect the other", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    await withProps(da, "/dav/a.txt", "one");
    expect((await da.copy("/dav/a.txt", "/dav/b.txt")).status).toBe(201);
    expect(await valueAt(da, "/dav/b.txt")).toBe("one");
    await withProps(da, "/dav/b.txt", "two");
    expect(await valueAt(da, "/dav/a.txt")).toBe("one");

    expect((await da.copy("/dav/a.txt", "/dav/b.txt", "T")).status).toBe(204);
    expect(await valueAt(da, "/dav/b.txt")).toBe("one");
  });

  it("COPY of a collection copies every member's properties; Depth 0 only the collection's", async () => {
    const { da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.mkcol("/dav/Dir/Sub");
    await da.put("/dav/Dir/Sub/in.txt", "x");
    await withProps(da, "/dav/Dir/", "dir");
    await withProps(da, "/dav/Dir/Sub/", "sub");
    await withProps(da, "/dav/Dir/Sub/in.txt", "file");

    expect((await da.copy("/dav/Dir/", "/dav/Deep/")).status).toBe(201);
    expect(await valueAt(da, "/dav/Deep/")).toBe("dir");
    expect(await valueAt(da, "/dav/Deep/Sub/")).toBe("sub");
    expect(await valueAt(da, "/dav/Deep/Sub/in.txt")).toBe("file");

    expect((await da.copy("/dav/Dir/", "/dav/Shallow/").set("Depth", "0")).status).toBe(201);
    expect(await valueAt(da, "/dav/Shallow/")).toBe("dir");
    expect((await da.get("/dav/Shallow/Sub/")).status).toBe(404);
  });

  it("MOVE keeps the properties, a PUT over the file keeps them, DELETE and a new file do not", async () => {
    const { h, da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.put("/dav/Dir/a.txt", "x");
    await withProps(da, "/dav/Dir/a.txt", "kept");
    expect((await da.move("/dav/Dir/", "/dav/Renamed/")).status).toBe(201);
    expect(await valueAt(da, "/dav/Renamed/a.txt")).toBe("kept");
    expect((await da.put("/dav/Renamed/a.txt", "new content")).status).toBe(204);
    expect(await valueAt(da, "/dav/Renamed/a.txt")).toBe("kept");

    expect((await da.del("/dav/Renamed/a.txt")).status).toBe(204);
    expect((await da.put("/dav/Renamed/a.txt", "fresh")).status).toBe(201);
    expect(await valueAt(da, "/dav/Renamed/a.txt")).toBeUndefined();
    expect(h.db.select().from(davProperties).all()).toHaveLength(1);
  });

  it("are removed with the row when the trash is emptied, not before", async () => {
    const { h, a, da } = await setup();
    await da.put("/dav/a.txt", "x");
    await withProps(da, "/dav/a.txt", "p");
    await da.del("/dav/a.txt");
    expect(h.db.select().from(davProperties).all()).toHaveLength(1);
    const trashed = (await a.get("/api/trash")).body as { items: { id: string }[] };
    const id = trashed.items[0]?.id;
    expect((await a.del(`/api/trash/${id}`)).status).toBe(204);
    expect(h.db.select().from(davProperties).all()).toHaveLength(0);
  });
});
