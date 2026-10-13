import { DavError } from "./errors.js";

/*
 * The If header (RFC 4918 section 10.4). A header is a set of lists, optionally each tagged with
 * the resource it speaks about; a list holds when all its conditions do, the header when any list
 * does. A header that holds nowhere fails the request with 412 whether or not the resource is
 * locked. Lock tokens in a list that holds are the ones the client has submitted.
 */

const MAX_LISTS = 64;
const MAX_CONDITIONS = 256;
const MAX_TERM = 2048;

type Condition = { negated: boolean } & ({ token: string } | { etag: string });

interface IfList {
  /** The resource tag; undefined for a list about the request's own resource. */
  tag: string | undefined;
  conditions: Condition[];
}

/** What a list can be tested against: the lock tokens that apply to a resource and its entity tag. */
export interface ResourceState {
  holds: (token: string) => boolean;
  /** The strong entity tag with its quotes, undefined when the resource has none. */
  etag: string | undefined;
}

function malformed(): never {
  throw new DavError(400);
}

function term(raw: string, from: number, close: string, quoted: boolean): [string, number] {
  let i = from + 1;
  let inQuote = false;
  for (; i < raw.length; i++) {
    const c = raw[i];
    if (quoted && c === '"') inQuote = !inQuote;
    else if (c === close && !inQuote) break;
  }
  if (i >= raw.length) return malformed();
  const value = raw.slice(from + 1, i);
  if (value.length === 0 || value.length > MAX_TERM) return malformed();
  return [value, i + 1];
}

export function parseIfHeader(raw: string): IfList[] {
  const lists: IfList[] = [];
  let conditions = 0;
  let tag: string | undefined;
  let i = 0;
  const skipSpace = (): void => {
    while (/\s/.test(raw[i] ?? "x")) i++;
  };
  for (;;) {
    skipSpace();
    if (i >= raw.length) break;
    if (raw[i] === "<") {
      [tag, i] = term(raw, i, ">", false);
      continue;
    }
    if (raw[i] !== "(" || lists.length >= MAX_LISTS) return malformed();
    i++;
    const list: IfList = { tag, conditions: [] };
    for (;;) {
      skipSpace();
      if (raw[i] === ")") {
        i++;
        break;
      }
      const negated = /^not(?=[\s<[])/i.test(raw.slice(i, i + 4));
      if (negated) {
        i += 3;
        skipSpace();
      }
      if (++conditions > MAX_CONDITIONS) return malformed();
      if (raw[i] === "<") {
        let token: string;
        [token, i] = term(raw, i, ">", false);
        list.conditions.push({ negated, token });
      } else if (raw[i] === "[") {
        let etag: string;
        [etag, i] = term(raw, i, "]", true);
        list.conditions.push({ negated, etag });
      } else {
        return malformed();
      }
    }
    if (list.conditions.length === 0) return malformed();
    lists.push(list);
  }
  if (lists.length === 0) return malformed();
  return lists;
}

/**
 * Evaluate an If header; returns the lock tokens it submits. Throws 400 when it cannot be read
 * and 412 when it holds for no list. No header (or an empty one) submits nothing and always passes.
 */
export function evaluateIf(
  header: string | undefined,
  stateOf: (tag: string | undefined) => ResourceState,
): ReadonlySet<string> {
  const submitted = new Set<string>();
  if (header === undefined || header.trim() === "") return submitted;
  const states = new Map<string | undefined, ResourceState>();
  const state = (tag: string | undefined): ResourceState => {
    let found = states.get(tag);
    if (!found) {
      found = stateOf(tag);
      states.set(tag, found);
    }
    return found;
  };

  let held = false;
  for (const list of parseIfHeader(header)) {
    const target = state(list.tag);
    const holds = list.conditions.every((condition) => {
      const matches =
        "token" in condition
          ? target.holds(condition.token)
          : target.etag !== undefined && target.etag === condition.etag;
      return matches !== condition.negated;
    });
    if (!holds) continue;
    held = true;
    for (const condition of list.conditions) {
      if ("token" in condition && !condition.negated) submitted.add(condition.token);
    }
  }
  if (!held) throw new DavError(412);
  return submitted;
}
