import { describe, expect, it } from "vitest";
import { destinationSegments, hrefFor, parseSegments } from "./paths.js";
import {
  depthOf,
  lockTimeoutSeconds,
  lockTokenHeader,
  parsePropertyUpdate,
  parsePropfind,
  submittedTokens,
} from "./requests.js";
import { escapeAttribute, escapeText, parseXml, XmlError } from "./xml.js";

describe("parseXml", () => {
  it("resolves prefixes and default namespaces", () => {
    const root = parseXml(
      '<?xml version="1.0" encoding="utf-8"?>\n<!-- c --><a:r xmlns:a="DAV:" xmlns="urn:x"><a:p/><q><a:z>t &amp; &#65;&#x42;</a:z></q></a:r>',
    );
    expect([root.ns, root.name]).toEqual(["DAV:", "r"]);
    expect(root.children.map((c) => [c.ns, c.name])).toEqual([
      ["DAV:", "p"],
      ["urn:x", "q"],
    ]);
    expect(root.children[1]?.children[0]?.text).toBe("t & AB");
  });

  it("supports CDATA, comments inside elements, single-quoted attributes and a BOM", () => {
    const root = parseXml("﻿<r xmlns='DAV:'><![CDATA[<raw>]]><!-- x --></r>");
    expect(root.text).toBe("<raw>");
  });

  it.each([
    ["a DOCTYPE", '<!DOCTYPE r [<!ENTITY e "x">]><r/>'],
    ["a lower-case doctype", "<!doctype r><r/>"],
    ["an ENTITY outside a DOCTYPE", '<!ENTITY e "x"><r/>'],
    ["a user-defined entity reference", "<r>&e;</r>"],
    ["a processing instruction", '<r><?php echo "x"?></r>'],
    ["a second declaration", '<?xml version="1.0"?><?xml version="1.0"?><r/>'],
    ["an undeclared prefix", "<a:r/>"],
    ["a mismatched end tag", "<a></b>"],
    ["an unterminated element", "<a><b></a>"],
    ["content after the root", "<a/><b/>"],
    ["text before the root", "x<a/>"],
    ["an unquoted attribute", "<a b=c/>"],
    ["a duplicate-free but unterminated attribute", '<a b="c/>'],
    ["a bad character reference", "<a>&#0;</a>"],
    ["a huge character reference", "<a>&#x110000;</a>"],
    ["an entity named like an object property", "<a>&constructor;</a>"],
    ["an unterminated comment", "<a><!-- </a>"],
    ["an empty document", ""],
    ["a non-ASCII element name", "<é/>"],
  ])("rejects %s", (_name, input) => {
    expect(() => parseXml(input)).toThrow(XmlError);
  });

  it("caps nesting depth and element count", () => {
    expect(() => parseXml("<a>".repeat(40) + "</a>".repeat(40))).toThrow(XmlError);
    expect(() => parseXml(`<a>${"<b/>".repeat(2500)}</a>`)).toThrow(XmlError);
    expect(() => parseXml(`<a>${"<b/>".repeat(1500)}</a>`)).not.toThrow();
  });
});

describe("escaping", () => {
  it("escapes markup and replaces characters XML cannot carry", () => {
    expect(escapeText('a & <b> "c"')).toBe('a &amp; &lt;b&gt; "c"');
    expect(escapeAttribute('a"b')).toBe("a&quot;b");
    expect(escapeText("x\u0001y￾z\ud800")).toBe("x�y�z�");
    expect(escapeText("🚀")).toBe("🚀");
  });
});

describe("request bodies", () => {
  it("parses PROPFIND variants", () => {
    expect(parsePropfind("")).toEqual({ kind: "allprop" });
    expect(parsePropfind('<propfind xmlns="DAV:"><propname/></propfind>')).toEqual({
      kind: "propname",
    });
    expect(parsePropfind('<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>')).toEqual({
      kind: "allprop",
    });
    expect(
      parsePropfind(
        '<D:propfind xmlns:D="DAV:" xmlns:Z="urn:z"><D:prop><D:getetag/><Z:x/></D:prop></D:propfind>',
      ),
    ).toEqual({
      kind: "prop",
      props: [
        { ns: "DAV:", name: "getetag" },
        { ns: "urn:z", name: "x" },
      ],
    });
    expect(() => parsePropfind('<D:propfind xmlns:D="DAV:"/>')).toThrow();
    expect(() => parsePropfind("<propfind/>")).toThrow();
  });

  it("collects the properties of a propertyupdate", () => {
    const props = parsePropertyUpdate(
      '<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:a/><D:b/></D:prop></D:set><D:remove><D:prop><D:c/></D:prop></D:remove></D:propertyupdate>',
    );
    expect(props.map((p) => p.name)).toEqual(["a", "b", "c"]);
    expect(() => parsePropertyUpdate("")).toThrow();
  });
});

describe("header parsing", () => {
  const h = (headers: Record<string, string>) => ({ headers });
  it("reads Depth, Timeout, Lock-Token and If", () => {
    expect(depthOf(h({}))).toBeUndefined();
    expect(depthOf(h({ depth: "Infinity" }))).toBe("infinity");
    expect(depthOf(h({ depth: "5" }))).toBeNull();
    expect(lockTimeoutSeconds(h({}))).toBe(3600);
    expect(lockTimeoutSeconds(h({ timeout: "Infinite, Second-30" }))).toBe(30);
    expect(lockTimeoutSeconds(h({ timeout: "Second-99999" }))).toBe(3600);
    expect(lockTimeoutSeconds(h({ timeout: "Second-0" }))).toBe(1);
    expect(lockTokenHeader(h({ "lock-token": "<opaquelocktoken:abc>" }))).toBe(
      "opaquelocktoken:abc",
    );
    expect(lockTokenHeader(h({ "lock-token": "opaquelocktoken:abc" }))).toBeUndefined();
    expect([...submittedTokens(h({ if: '</dav/a> (<t1> ["e"]) (Not <t2> <t3>)' }))]).toEqual([
      "t1",
      "t3",
    ]);
    expect(submittedTokens(h({})).size).toBe(0);
  });
});

describe("paths", () => {
  it("splits and decodes segment by segment", () => {
    expect(parseSegments("/")).toEqual([]);
    expect(parseSegments("/a//b%20c/")).toEqual(["a", "b c"]);
    expect(parseSegments("/cafe%CC%81")).toEqual(["café"]);
    for (const bad of [
      "/a%2Fb",
      "/a%5Cb",
      "/%00",
      "/..",
      "/.",
      "/%zz",
      "/%C3",
      "/%20x",
      `/${"x".repeat(256)}`,
    ]) {
      expect(parseSegments(bad), bad).toBeNull();
    }
  });

  it("builds encoded hrefs", () => {
    expect(hrefFor([], true)).toBe("/dav/");
    expect(hrefFor(["a b", "c#d?"], true)).toBe("/dav/a%20b/c%23d%3F/");
    expect(hrefFor(["f.txt"], false)).toBe("/dav/f.txt");
  });

  it("accepts only same-host destinations inside /dav", () => {
    const hosts = ["cloud.example"];
    expect(destinationSegments("https://cloud.example/dav/a/b%20c", hosts)).toEqual({
      segments: ["a", "b c"],
      local: true,
    });
    expect(destinationSegments("/dav/a", hosts)).toEqual({ segments: ["a"], local: true });
    expect(destinationSegments("/DAV/", hosts)).toEqual({ segments: [], local: true });
    expect(destinationSegments("https://other.example/dav/a", hosts).local).toBe(false);
    expect(destinationSegments("https://cloud.example/api/a", hosts).local).toBe(false);
    expect(destinationSegments("https://cloud.example/davx/a", hosts).local).toBe(false);
    expect(destinationSegments("https://cloud.example/dav/a%2Fb", hosts)).toEqual({
      segments: null,
      local: true,
    });
    expect(destinationSegments("http://", hosts).local).toBe(false);
  });
});
