import type request from "supertest";
import { describe, expect, it } from "vitest";
import { bodyText, davSetup as setup, listing } from "../testing/dav.js";
import { binary, ORIGIN } from "../testing/harness.js";

const TOKEN = /^<opaquelocktoken:[0-9a-f-]{36}>$/;

async function lockToken(r: request.Test): Promise<string> {
  const res = await r;
  expect(res.status).toBeLessThan(300);
  const header = res.get("Lock-Token") ?? "";
  expect(header).toMatch(TOKEN);
  return header.slice(1, -1);
}

describe("WebDAV: locking", () => {
  it("LOCK answers with a token and the lock description; UNLOCK releases it", async () => {
    const { da } = await setup();
    await da.put("/dav/doc.txt", "x");
    const res = await binary(da.lock("/dav/doc.txt"));
    expect(res.status).toBe(200);
    expect(res.get("Lock-Token")).toMatch(TOKEN);
    const body = (res.body as Buffer).toString("utf8");
    expect(body).toContain("<D:lockdiscovery><D:activelock>");
    expect(body).toContain("<D:exclusive/>");
    expect(body).toContain("Second-3600");
    expect(body).toContain("mailto:me@example.com");
    const token = (res.get("Lock-Token") ?? "").slice(1, -1);
    expect(body).toContain(token);

    expect((await da.unlock("/dav/doc.txt", token)).status).toBe(204);
    expect((await da.unlock("/dav/doc.txt", token)).status).toBe(409);
    expect((await da.put("/dav/doc.txt", "free")).status).toBe(204);
  });

  it("blocks PUT without the token (423) and allows it with the token", async () => {
    const { da } = await setup();
    await da.put("/dav/doc.txt", "x");
    const token = await lockToken(da.lock("/dav/doc.txt"));

    const blocked = await da.put("/dav/doc.txt", "no token");
    expect(blocked.status).toBe(423);
    expect(await bodyText(da.put("/dav/doc.txt", "no token"))).toContain("lock-token-submitted");
    expect(await da.text("/dav/doc.txt")).toBe("x");

    const wrong = await da
      .req("PUT", "/dav/doc.txt")
      .set("If", "(<opaquelocktoken:00000000-0000-4000-8000-000000000000>)")
      .send("x");
    expect(wrong.status).toBe(412);
    const negated = await da.req("PUT", "/dav/doc.txt").set("If", `(Not <${token}>)`).send("x");
    expect(negated.status).toBe(412);
    const unrelated = await da
      .req("PUT", "/dav/doc.txt")
      .set("If", "(Not <opaquelocktoken:00000000-0000-4000-8000-000000000000>)")
      .send("x");
    expect(unrelated.status).toBe(423);

    const ok = await da.req("PUT", "/dav/doc.txt").set("If", `(<${token}>)`).send("with token");
    expect(ok.status).toBe(204);
    expect(await da.text("/dav/doc.txt")).toBe("with token");
    const etag = ok.get("ETag") ?? "";
    const stale = await da
      .req("PUT", "/dav/doc.txt")
      .set("If", `<${ORIGIN}/dav/doc.txt> (<${token}> ["etag"])`)
      .send("tagged");
    expect(stale.status).toBe(412);
    const tagged = await da
      .req("PUT", "/dav/doc.txt")
      .set("If", `<${ORIGIN}/dav/doc.txt> (<${token}> [${etag}])`)
      .send("tagged");
    expect(tagged.status).toBe(204);

    expect((await da.unlock("/dav/doc.txt", token)).status).toBe(204);
    expect((await da.put("/dav/doc.txt", "after")).status).toBe(204);
  });

  it("protects a locked file from DELETE, MOVE and PROPPATCH without the token", async () => {
    const { da } = await setup();
    await da.put("/dav/doc.txt", "x");
    const token = await lockToken(da.lock("/dav/doc.txt"));
    const patch =
      '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:displayname>n</D:displayname></D:prop></D:set></D:propertyupdate>';

    expect((await da.del("/dav/doc.txt")).status).toBe(423);
    expect((await da.move("/dav/doc.txt", "/dav/other.txt")).status).toBe(423);
    expect((await da.copy("/dav/doc.txt", "/dav/other.txt")).status).toBe(201);
    expect((await da.proppatch("/dav/doc.txt", patch)).status).toBe(423);
    expect((await da.copy("/dav/other.txt", "/dav/doc.txt")).status).toBe(423);

    const ifHeader = `(<${token}>)`;
    expect(
      (
        await da
          .req("PROPPATCH", "/dav/doc.txt")
          .set("If", ifHeader)
          .set("Content-Type", "application/xml")
          .send(patch)
      ).status,
    ).toBe(207);
    expect((await da.move("/dav/doc.txt", "/dav/renamed.txt").set("If", ifHeader)).status).toBe(
      201,
    );
    // The lock belonged to the old path; the moved file is free.
    expect((await da.put("/dav/renamed.txt", "free")).status).toBe(204);
    expect((await da.put("/dav/doc.txt", "new")).status).toBe(201);
  });

  it("DELETE with the token works and drops the lock", async () => {
    const { da } = await setup();
    await da.put("/dav/doc.txt", "x");
    const token = await lockToken(da.lock("/dav/doc.txt"));
    expect((await da.del("/dav/doc.txt").set("If", `(<${token}>)`)).status).toBe(204);
    expect((await da.put("/dav/doc.txt", "again")).status).toBe(201);
    expect((await da.unlock("/dav/doc.txt", token)).status).toBe(409);
  });

  it("refuses a second lock on a locked resource", async () => {
    const { da } = await setup();
    await da.put("/dav/doc.txt", "x");
    await lockToken(da.lock("/dav/doc.txt"));
    expect((await da.lock("/dav/doc.txt")).status).toBe(423);
  });

  it("a depth-infinity lock on a collection covers its members and blocks locking below", async () => {
    const { da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.put("/dav/Dir/in.txt", "x");
    const token = await lockToken(da.lock("/dav/Dir/"));

    expect((await da.put("/dav/Dir/in.txt", "y")).status).toBe(423);
    expect((await da.put("/dav/Dir/new.txt", "y")).status).toBe(423);
    expect((await da.mkcol("/dav/Dir/Sub")).status).toBe(423);
    expect((await da.del("/dav/Dir/in.txt")).status).toBe(423);
    expect((await da.lock("/dav/Dir/in.txt")).status).toBe(423);
    expect((await da.put("/dav/elsewhere.txt", "ok")).status).toBe(201);

    const ifHeader = `(<${token}>)`;
    expect((await da.req("PUT", "/dav/Dir/new.txt").set("If", ifHeader).send("y")).status).toBe(
      201,
    );
    expect((await da.req("MKCOL", "/dav/Dir/Sub").set("If", ifHeader)).status).toBe(201);
    expect((await da.unlock("/dav/Dir/", token)).status).toBe(204);
    expect((await da.put("/dav/Dir/in.txt", "z")).status).toBe(204);
  });

  it("a depth-0 lock on a collection protects its membership, not the members' content", async () => {
    const { da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.put("/dav/Dir/in.txt", "x");
    await lockToken(da.lock("/dav/Dir/", { depth: "0" }));
    expect((await da.put("/dav/Dir/in.txt", "edited")).status).toBe(204);
    expect((await da.put("/dav/Dir/added.txt", "n")).status).toBe(423);
    expect((await da.del("/dav/Dir/in.txt")).status).toBe(423);
  });

  it("deleting or moving a collection needs the tokens of locks below it", async () => {
    const { da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.put("/dav/Dir/in.txt", "x");
    const token = await lockToken(da.lock("/dav/Dir/in.txt"));
    expect((await da.del("/dav/Dir/")).status).toBe(423);
    expect((await da.move("/dav/Dir/", "/dav/Moved/")).status).toBe(423);
    expect((await da.del("/dav/Dir/").set("If", `(<${token}>)`)).status).toBe(204);
  });

  it("locking an unmapped URL creates an empty file; a missing parent is 409", async () => {
    const { a, da } = await setup();
    const res = await da.lock("/dav/fresh.txt");
    expect(res.status).toBe(201);
    const token = (res.get("Lock-Token") ?? "").slice(1, -1);
    expect((await a.root()).children[0]).toMatchObject({ name: "fresh.txt", size: 0 });
    expect((await da.put("/dav/fresh.txt", "content")).status).toBe(423);
    expect(
      (await da.req("PUT", "/dav/fresh.txt").set("If", `(<${token}>)`).send("content")).status,
    ).toBe(204);
    expect((await da.lock("/dav/no/such/file.txt")).status).toBe(409);
  });

  it("honours Timeout, caps it at one hour, and expires locks", async () => {
    const { h, da } = await setup();
    await da.put("/dav/doc.txt", "x");
    const short = await binary(da.lock("/dav/doc.txt", { timeout: "Second-60" }));
    expect((short.body as Buffer).toString()).toContain("Second-60");
    expect((await da.put("/dav/doc.txt", "x")).status).toBe(423);
    h.clock.t += 61_000;
    expect((await da.put("/dav/doc.txt", "x")).status).toBe(204);

    const long = await binary(da.lock("/dav/doc.txt", { timeout: "Infinite, Second-999999" }));
    expect((long.body as Buffer).toString()).toContain("Second-3600");
    const none = await binary(da.lock("/dav/other.txt"));
    expect((none.body as Buffer).toString()).toContain("Second-3600");
    h.clock.t += 3601_000;
    expect((await da.put("/dav/doc.txt", "x")).status).toBe(204);
  });

  it("refreshes a lock with an empty LOCK request carrying the token", async () => {
    const { h, da } = await setup();
    await da.put("/dav/doc.txt", "x");
    const token = await lockToken(da.lock("/dav/doc.txt", { timeout: "Second-60" }));
    h.clock.t += 50_000;
    const refreshed = await binary(
      da.req("LOCK", "/dav/doc.txt").set("If", `(<${token}>)`).set("Timeout", "Second-120"),
    );
    expect(refreshed.status).toBe(200);
    expect((refreshed.body as Buffer).toString()).toContain("Second-120");
    h.clock.t += 100_000;
    expect((await da.put("/dav/doc.txt", "x")).status).toBe(423);
    expect(
      (await da.req("LOCK", "/dav/doc.txt").set("If", "(<opaquelocktoken:nope>)")).status,
    ).toBe(412);
  });

  it("reports active locks through lockdiscovery", async () => {
    const { da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.put("/dav/Dir/in.txt", "x");
    const token = await lockToken(da.lock("/dav/Dir/"));
    const body =
      '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:lockdiscovery/></D:prop></D:propfind>';
    const entries = await listing(da.propfind("/dav/Dir/", "1", body));
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      const lock = entry.props.get(200)?.get("lockdiscovery")?.children[0];
      expect(lock?.name).toBe("activelock");
      const href = lock?.children.find((c) => c.name === "locktoken")?.children[0]?.text;
      expect(href).toBe(token);
    }
    const root = await listing(da.propfind("/dav/", "0", body));
    expect(root[0]?.props.get(200)?.get("lockdiscovery")?.children).toHaveLength(0);
  });

  it("rejects malformed LOCK and UNLOCK requests", async () => {
    const { da } = await setup();
    await da.put("/dav/doc.txt", "x");
    const shared =
      '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';
    expect(
      (await da.req("LOCK", "/dav/doc.txt").set("Content-Type", "application/xml").send(shared))
        .status,
    ).toBe(400);
    expect(
      (await da.req("LOCK", "/dav/doc.txt").set("Content-Type", "application/xml").send("<oops"))
        .status,
    ).toBe(400);
    const advertised = await listing(
      da.propfind(
        "/dav/doc.txt",
        "0",
        '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:supportedlock/></D:prop></D:propfind>',
      ),
    );
    const entries = advertised[0]?.props.get(200)?.get("supportedlock")?.children;
    expect(entries?.map((e) => e.children[0]?.children[0]?.name)).toEqual(["exclusive"]);
    expect((await da.lock("/dav/doc.txt", { depth: "1" })).status).toBe(400);
    expect((await da.req("UNLOCK", "/dav/doc.txt")).status).toBe(400);
    expect((await da.unlock("/dav/doc.txt", "opaquelocktoken:none")).status).toBe(409);
  });

  it("keeps locks per user", async () => {
    const { da, dbb } = await setup();
    await da.put("/dav/doc.txt", "x");
    await dbb.put("/dav/doc.txt", "y");
    const token = await lockToken(da.lock("/dav/doc.txt"));
    expect((await dbb.put("/dav/doc.txt", "y2")).status).toBe(204);
    expect((await dbb.unlock("/dav/doc.txt", token)).status).toBe(409);
    expect((await da.put("/dav/doc.txt", "x2")).status).toBe(423);
  });
});

describe("WebDAV: the If header", () => {
  const bogus = "opaquelocktoken:00000000-0000-4000-8000-000000000000";

  it("fails a write with 412 when no list holds, locked or not", async () => {
    const { da } = await setup();
    const created = await da.put("/dav/doc.txt", "x");
    const etag = created.get("ETag") ?? "";
    const put = (condition: string) => da.req("PUT", "/dav/doc.txt").set("If", condition).send("y");

    expect((await put(`(<${bogus}>)`)).status).toBe(412);
    expect((await put('(["bogus"])')).status).toBe(412);
    expect((await put(`(<${bogus}> ["bogus"]) (<DAV:no-lock> [${etag}] <${bogus}>)`)).status).toBe(
      412,
    );
    expect((await put(`([${etag}] Not [${etag}])`)).status).toBe(412);
    expect((await put(`([W/${etag}])`)).status).toBe(412);
    expect(await da.text("/dav/doc.txt")).toBe("x");

    expect((await put(`([${etag}])`)).status).toBe(204);
    expect((await put(`(<${bogus}>) (Not <${bogus}>)`)).status).toBe(204);
    expect((await put(`(<${bogus}> ["bogus"]) (Not <DAV:no-lock> Not ["bogus"])`)).status).toBe(
      204,
    );
    expect((await put("(Not <DAV:no-lock>)")).status).toBe(204);
    expect((await put('(Not ["bogus"])')).status).toBe(204);
  });

  it("is evaluated for a resource that does not exist yet", async () => {
    const { da } = await setup();
    const put = (condition: string) => da.req("PUT", "/dav/new.txt").set("If", condition).send("y");
    expect((await put('(["bogus"])')).status).toBe(412);
    expect((await put(`(<${bogus}>)`)).status).toBe(412);
    expect((await put('(Not ["bogus"])')).status).toBe(201);
  });

  it("applies to the other methods that change things", async () => {
    const { da } = await setup();
    await da.put("/dav/doc.txt", "x");
    const patch =
      '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><Z:p xmlns:Z="urn:z">v</Z:p></D:prop></D:set></D:propertyupdate>';
    const failing = `(<${bogus}>)`;
    expect((await da.req("PROPPATCH", "/dav/doc.txt").set("If", failing).send(patch)).status).toBe(
      412,
    );
    expect((await da.del("/dav/doc.txt").set("If", failing)).status).toBe(412);
    expect((await da.move("/dav/doc.txt", "/dav/b.txt").set("If", failing)).status).toBe(412);
    expect((await da.copy("/dav/doc.txt", "/dav/b.txt").set("If", failing)).status).toBe(412);
    expect((await da.req("MKCOL", "/dav/Dir").set("If", failing)).status).toBe(412);
    expect((await da.get("/dav/b.txt")).status).toBe(404);
    expect((await da.get("/dav/doc.txt")).status).toBe(200);
  });

  it("reads a tag as the resource it names; a tag outside this server matches nothing", async () => {
    const { da } = await setup();
    const doc = (await da.put("/dav/doc.txt", "x")).get("ETag") ?? "";
    await da.put("/dav/other.txt", "y");
    const put = (condition: string) => da.req("PUT", "/dav/doc.txt").set("If", condition).send("z");
    expect((await put(`</dav/doc.txt> ([${doc}])`)).status).toBe(204);
    expect((await put(`</dav/other.txt> ([${doc}])`)).status).toBe(412);
    expect((await put(`<http://elsewhere.example/dav/doc.txt> ([${doc}])`)).status).toBe(412);
    expect((await put(`</dav/nothing.txt> (Not [${doc}])`)).status).toBe(204);
  });

  it("answers 400 to a header it cannot read", async () => {
    const { da } = await setup();
    await da.put("/dav/doc.txt", "x");
    for (const condition of ["garbage", "()", "(<unclosed)", "(Not)", "(<a>", "</dav/doc.txt>"]) {
      const res = await da.req("PUT", "/dav/doc.txt").set("If", condition).send("y");
      expect(res.status, condition).toBe(400);
    }
    expect(await da.text("/dav/doc.txt")).toBe("x");
  });

  it("lets PROPPATCH through a lock only with its token, and stores nothing otherwise", async () => {
    const { da } = await setup();
    await da.put("/dav/doc.txt", "x");
    const token = await lockToken(da.lock("/dav/doc.txt"));
    const patch =
      '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><Z:p xmlns:Z="urn:z">v</Z:p></D:prop></D:set></D:propertyupdate>';
    const ask =
      '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><Z:p xmlns:Z="urn:z"/></D:prop></D:propfind>';

    expect((await da.proppatch("/dav/doc.txt", patch)).status).toBe(423);
    expect(
      (await da.req("PROPPATCH", "/dav/doc.txt").set("If", `(<${bogus}>)`).send(patch)).status,
    ).toBe(412);
    expect((await listing(da.propfind("/dav/doc.txt", "0", ask)))[0]?.props.has(200)).toBe(false);

    const ok = await da.req("PROPPATCH", "/dav/doc.txt").set("If", `(<${token}>)`).send(patch);
    expect(ok.status).toBe(207);
    const stored = await listing(da.propfind("/dav/doc.txt", "0", ask));
    expect(stored[0]?.props.get(200)?.get("p")?.text).toBe("v");
  });
});
