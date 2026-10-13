import { describe, expect, it } from "vitest";
import { DavError } from "./errors.js";
import { evaluateIf, parseIfHeader, type ResourceState } from "./conditions.js";

const state = (tokens: string[], etag?: string): ResourceState => ({
  holds: (token) => tokens.includes(token),
  etag,
});

function statusOf(run: () => unknown): number | undefined {
  try {
    run();
  } catch (err) {
    if (err instanceof DavError) return err.status;
    throw err;
  }
  return undefined;
}

describe("parseIfHeader", () => {
  it("reads tagged and untagged lists with Not, tokens and entity tags", () => {
    expect(
      parseIfHeader('</dav/a> (<t1> ["e"]) (Not <t2> <t3>) (nOt ["w"])  <http://h/b> (<t4>)'),
    ).toEqual([
      {
        tag: "/dav/a",
        conditions: [
          { negated: false, token: "t1" },
          { negated: false, etag: '"e"' },
        ],
      },
      {
        tag: "/dav/a",
        conditions: [
          { negated: true, token: "t2" },
          { negated: false, token: "t3" },
        ],
      },
      { tag: "/dav/a", conditions: [{ negated: true, etag: '"w"' }] },
      { tag: "http://h/b", conditions: [{ negated: false, token: "t4" }] },
    ]);
    expect(parseIfHeader("(<a>)")[0]?.tag).toBeUndefined();
  });

  it("keeps a ] inside a quoted entity tag", () => {
    expect(parseIfHeader('(["a]b"])')[0]?.conditions).toEqual([{ negated: false, etag: '"a]b"' }]);
  });

  it.each([
    ["no list", "<tag>"],
    ["an empty list", "()"],
    ["a bare word", "garbage"],
    ["an unterminated list", "(<a>"],
    ["an unterminated token", "(<a)"],
    ["an unterminated entity tag", '(["a)'],
    ["Not without a condition", "(Not)"],
    ["an empty token", "(<>)"],
    ["a condition that is neither", "(a)"],
  ])("rejects %s with 400", (_name, header) => {
    expect(statusOf(() => parseIfHeader(header))).toBe(400);
  });

  it("bounds the number of lists and conditions", () => {
    expect(statusOf(() => parseIfHeader("(<a>)".repeat(64)))).toBeUndefined();
    expect(statusOf(() => parseIfHeader("(<a>)".repeat(65)))).toBe(400);
    expect(statusOf(() => parseIfHeader(`(${"<a>".repeat(256)})`))).toBeUndefined();
    expect(statusOf(() => parseIfHeader(`(${"<a>".repeat(257)})`))).toBe(400);
  });
});

describe("evaluateIf", () => {
  const here = state(["lock-1"], '"v1"');

  it("passes without a header (or an empty one) and submits nothing", () => {
    expect(evaluateIf(undefined, () => here).size).toBe(0);
    expect(evaluateIf("  ", () => here).size).toBe(0);
  });

  it("holds when any list holds, and submits only the tokens of lists that hold", () => {
    const submitted = evaluateIf('(<lock-2> ["v1"]) (<lock-1> ["v1"]) (Not <lock-3>)', () => here);
    expect([...submitted]).toEqual(["lock-1"]);
  });

  it("fails with 412 when no list holds, with or without locks", () => {
    expect(statusOf(() => evaluateIf("(<other>)", () => here))).toBe(412);
    expect(statusOf(() => evaluateIf('(["v2"])', () => here))).toBe(412);
    expect(statusOf(() => evaluateIf("(<other>)", () => state([])))).toBe(412);
    expect(statusOf(() => evaluateIf('(["v1"])', () => state([])))).toBe(412);
    expect(statusOf(() => evaluateIf("(Not <lock-1>)", () => here))).toBe(412);
  });

  it("treats a missing or weak entity tag as not matching, so Not holds", () => {
    expect(statusOf(() => evaluateIf('(["v1"])', () => state([], undefined)))).toBe(412);
    expect(statusOf(() => evaluateIf('(Not ["v1"])', () => state([], undefined)))).toBeUndefined();
    expect(statusOf(() => evaluateIf('([W/"v1"])', () => here))).toBe(412);
  });

  it("looks each tag up once and tests a list against the resource it names", () => {
    const asked: (string | undefined)[] = [];
    const states: Record<string, ResourceState> = { "/a": state(["ta"]), "/b": state(["tb"]) };
    const submitted = evaluateIf("</a> (<ta>) (<tb>) </b> (<tb>) (Not <ta>)", (tag) => {
      asked.push(tag);
      return states[tag ?? ""] ?? state([]);
    });
    expect([...submitted]).toEqual(["ta", "tb"]);
    expect(asked).toEqual(["/a", "/b"]);
  });

  it("answers 400 for a header it cannot read", () => {
    expect(statusOf(() => evaluateIf("(<a", () => here))).toBe(400);
  });
});
