/*
 * A deliberately small XML reader for the three request bodies WebDAV needs (PROPFIND,
 * PROPPATCH, LOCK) plus the escaping used when writing responses. Not a general parser:
 *   - DOCTYPE, entity declarations and processing instructions (other than the leading XML
 *     declaration) are rejected, so there is nothing to expand: no XXE, no billion laughs.
 *   - Only the five predefined entities and numeric character references are understood.
 *   - Namespaces are resolved (prefixes, default namespace). Attributes are checked, not kept,
 *     but an element's source text and namespace context are, so a dead property can be stored
 *     and sent back exactly as the client wrote it (see standaloneXml).
 *   - Depth, element count and name length are capped.
 */

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlError";
  }
}

export interface XmlElement {
  /** Namespace URI, "" when none. */
  ns: string;
  /** Local name. */
  name: string;
  children: XmlElement[];
  /** The element's own character data (children's text excluded), unmodified. */
  text: string;
  /** The element exactly as written, start tag to end tag. */
  source: string;
  /** Namespace bindings in scope from the parent: prefix to URI, "" is the default namespace. */
  inherited: ReadonlyMap<string, string>;
  /** The prefixes the element's own start tag declares. */
  declares: readonly string[];
}

const MAX_DEPTH = 32;
const MAX_ELEMENTS = 2000;
const NAME = /[A-Za-z_][A-Za-z0-9_.-]{0,99}(?::[A-Za-z_][A-Za-z0-9_.-]{0,99})?/y;
const FORBIDDEN_DECLARATION = /<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i;
const NON_XML_CHAR = /[^\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u;
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const amp = raw.indexOf("&", i);
    if (amp === -1) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, amp);
    const semi = raw.indexOf(";", amp);
    if (semi === -1 || semi - amp > 10) throw new XmlError("bad entity");
    const ref = raw.slice(amp + 1, semi);
    const named = NAMED_ENTITIES.get(ref);
    if (named !== undefined) {
      out += named;
    } else {
      const match = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(ref);
      if (!match) throw new XmlError("unknown entity");
      const code = match[1] !== undefined ? parseInt(match[1], 16) : parseInt(match[2] ?? "", 10);
      if (!isXmlChar(code)) throw new XmlError("bad character reference");
      out += String.fromCodePoint(code);
    }
    i = semi + 1;
  }
  return out;
}

type Scope = ReadonlyMap<string, string>;

class Reader {
  private pos = 0;
  private elements = 0;

  constructor(private readonly src: string) {}

  parseDocument(): XmlElement {
    if (FORBIDDEN_DECLARATION.test(this.src))
      throw new XmlError("DTD declarations are not allowed");
    if (NON_XML_CHAR.test(this.src)) throw new XmlError("character XML cannot carry");
    if (this.src.startsWith("<?xml") && /\s/.test(this.src[5] ?? "")) {
      const end = this.src.indexOf("?>");
      if (end === -1) throw new XmlError("unterminated declaration");
      this.pos = end + 2;
    }
    this.skipMisc();
    if (this.src[this.pos] !== "<") throw new XmlError("no root element");
    const root = this.parseElement(0, new Map([["xml", XML_NS]]));
    this.skipMisc();
    if (this.pos < this.src.length) throw new XmlError("content after the root element");
    return root;
  }

  /** Whitespace and comments between top-level constructs. */
  private skipMisc(): void {
    for (;;) {
      while (/\s/.test(this.src[this.pos] ?? "x")) this.pos++;
      if (this.src.startsWith("<!--", this.pos)) this.skipComment();
      else return;
    }
  }

  private skipComment(): void {
    const end = this.src.indexOf("-->", this.pos + 4);
    if (end === -1) throw new XmlError("unterminated comment");
    this.pos = end + 3;
  }

  private readName(): string {
    NAME.lastIndex = this.pos;
    const match = NAME.exec(this.src);
    if (!match) throw new XmlError("bad name");
    this.pos += match[0].length;
    return match[0];
  }

  private skipSpace(): boolean {
    const start = this.pos;
    while (/\s/.test(this.src[this.pos] ?? "x")) this.pos++;
    return this.pos > start;
  }

  private parseElement(depth: number, scope: Scope): XmlElement {
    if (depth >= MAX_DEPTH) throw new XmlError("nesting too deep");
    if (++this.elements > MAX_ELEMENTS) throw new XmlError("too many elements");
    const start = this.pos;
    this.pos++; // "<"
    const qname = this.readName();
    const declared = new Map(scope);
    const declares: string[] = [];
    const attributes: string[] = [];
    for (;;) {
      const spaced = this.skipSpace();
      const c = this.src[this.pos];
      if (c === ">" || c === "/") break;
      if (!spaced) throw new XmlError("malformed tag");
      const attr = this.readName();
      this.skipSpace();
      if (this.src[this.pos++] !== "=") throw new XmlError("attribute without value");
      this.skipSpace();
      const quote = this.src[this.pos++];
      if (quote !== '"' && quote !== "'") throw new XmlError("unquoted attribute");
      const end = this.src.indexOf(quote, this.pos);
      if (end === -1) throw new XmlError("unterminated attribute");
      const rawValue = this.src.slice(this.pos, end);
      if (rawValue.includes("<")) throw new XmlError("'<' in attribute");
      this.pos = end + 1;
      const value = decodeEntities(rawValue);
      if (attr === "xmlns" || attr.startsWith("xmlns:")) {
        const prefix = attr === "xmlns" ? "" : attr.slice(6);
        // Namespaces in XML 1.0: only the default namespace may be undeclared.
        if (prefix !== "" && value === "") throw new XmlError("a prefix cannot be undeclared");
        if (prefix === "xmlns" || (prefix === "xml") !== (value === XML_NS)) {
          throw new XmlError("reserved namespace binding");
        }
        if (declares.includes(prefix)) throw new XmlError("duplicate attribute");
        declares.push(prefix);
        declared.set(prefix, value);
      } else {
        attributes.push(attr);
      }
    }
    const [prefix, local] = qname.includes(":")
      ? (qname.split(":") as [string, string])
      : ["", qname];
    const ns = declared.get(prefix);
    if (ns === undefined) {
      if (prefix !== "") throw new XmlError("undeclared namespace prefix");
    }
    const expanded = new Set<string>();
    for (const attr of attributes) {
      const [attrPrefix, attrLocal] = attr.includes(":")
        ? (attr.split(":") as [string, string])
        : ["", attr];
      const attrNs = attrPrefix === "" ? "" : declared.get(attrPrefix);
      if (attrNs === undefined) throw new XmlError("undeclared namespace prefix");
      const key = `${attrNs}\u0000${attrLocal}`;
      if (expanded.has(key)) throw new XmlError("duplicate attribute");
      expanded.add(key);
    }
    const element: XmlElement = {
      ns: ns ?? "",
      name: local,
      children: [],
      text: "",
      source: "",
      inherited: scope,
      declares,
    };
    if (this.src[this.pos] === "/") {
      if (this.src[this.pos + 1] !== ">") throw new XmlError("malformed empty tag");
      this.pos += 2;
      element.source = this.src.slice(start, this.pos);
      return element;
    }
    this.pos++; // ">"
    for (;;) {
      const lt = this.src.indexOf("<", this.pos);
      if (lt === -1) throw new XmlError("unterminated element");
      element.text += decodeEntities(this.src.slice(this.pos, lt));
      this.pos = lt;
      if (this.src.startsWith("<!--", lt)) {
        this.skipComment();
      } else if (this.src.startsWith("<![CDATA[", lt)) {
        const end = this.src.indexOf("]]>", lt + 9);
        if (end === -1) throw new XmlError("unterminated CDATA");
        element.text += this.src.slice(lt + 9, end);
        this.pos = end + 3;
      } else if (this.src.startsWith("</", lt)) {
        this.pos += 2;
        if (this.readName() !== qname) throw new XmlError("mismatched end tag");
        this.skipSpace();
        if (this.src[this.pos++] !== ">") throw new XmlError("malformed end tag");
        element.source = this.src.slice(start, this.pos);
        return element;
      } else if (this.src[lt + 1] === "?" || this.src[lt + 1] === "!") {
        throw new XmlError("processing instructions are not allowed");
      } else {
        element.children.push(this.parseElement(depth + 1, declared));
      }
    }
  }
}

/** Parse a document. Throws XmlError; callers answer 400. */
export function parseXml(input: string): XmlElement {
  return new Reader(input.startsWith("\uFEFF") ? input.slice(1) : input).parseDocument();
}

/**
 * The element as a self-contained document fragment: its source text with the namespace
 * bindings it inherited declared again on its start tag, so it means the same anywhere.
 */
export function standaloneXml(element: XmlElement): string {
  let declarations = "";
  for (const [prefix, uri] of element.inherited) {
    if (prefix === "xml" || element.declares.includes(prefix) || (prefix === "" && uri === "")) {
      continue;
    }
    declarations += ` ${prefix === "" ? "xmlns" : `xmlns:${prefix}`}="${escapeAttribute(uri)}"`;
  }
  const tag = /^<[^\s/>]+/.exec(element.source)?.[0] ?? "<";
  return `${tag}${declarations}${element.source.slice(tag.length)}`;
}

/** Characters XML 1.0 cannot carry are replaced rather than emitted. */
function printable(value: string): string {
  let out = "";
  for (const ch of value) out += isXmlChar(ch.codePointAt(0) ?? 0) ? ch : "\uFFFD";
  return out;
}

export function escapeText(value: string): string {
  return printable(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;");
}

export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
}
