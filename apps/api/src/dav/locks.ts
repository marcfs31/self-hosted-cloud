import { DavError } from "./errors.js";
import { hrefFor, isBelow, isSamePath } from "./paths.js";
import { DEFAULT_LOCK_SECONDS, MAX_LOCK_SECONDS } from "./requests.js";
import { escapeText } from "./xml.js";

/*
 * Exclusive write locks (WebDAV class 2), kept in this process's memory. They are advisory:
 * they only constrain other WebDAV requests of the same server process, not the web UI, the
 * REST API or tus uploads, and they are forgotten on restart (clients treat a lost lock as
 * expired and re-lock). A lock is per user; trees are disjoint, so users never meet.
 */

const MAX_LOCKS_PER_USER = 500;

export interface Lock {
  token: string;
  userId: string;
  path: readonly string[];
  depth: "0" | "infinity";
  /** Already-escaped XML content of <owner>, when the client sent one. */
  ownerXml: string | undefined;
  timeoutSeconds: number;
  expiresAt: number;
}

export interface WriteScope {
  /** The request adds, removes or renames the path: a lock on its parent collection protects that. */
  membership?: boolean;
  /** The request removes or moves a whole subtree: locks anywhere below the path block it. */
  subtree?: boolean;
}

export interface LockManager {
  /** 423 unless every lock that protects the path was submitted by token. */
  assertWritable(
    userId: string,
    path: readonly string[],
    submitted: ReadonlySet<string>,
    scope?: WriteScope,
  ): void;
  /** 423 when a new lock at `path` would collide with an existing one. */
  assertLockable(userId: string, path: readonly string[], depth: "0" | "infinity"): void;
  create(input: {
    userId: string;
    path: readonly string[];
    depth: "0" | "infinity";
    ownerXml: string | undefined;
    timeoutSeconds: number;
  }): Lock;
  /** Whether the token names a live lock of the user that applies to the path, its parent or what lies below it. */
  holds(userId: string, path: readonly string[], token: string): boolean;
  /** The lock with this token if it belongs to the user and protects the path. */
  find(userId: string, path: readonly string[], token: string): Lock | undefined;
  refresh(lock: Lock, timeoutSeconds: number): Lock;
  remove(lock: Lock): void;
  /** Locks that protect the path itself (held on it, or on an ancestor with depth infinity). */
  discover(userId: string, path: readonly string[]): Lock[];
  /** Forget the locks on a path and everything below it (the resource is gone or moved). */
  removeUnder(userId: string, path: readonly string[]): void;
}

function covers(lock: Lock, path: readonly string[]): boolean {
  return isSamePath(lock.path, path) || (lock.depth === "infinity" && isBelow(path, lock.path));
}

export function createLockManager(now: () => number): LockManager {
  const locks = new Map<string, Lock>();

  function live(userId: string): Lock[] {
    const t = now();
    const result: Lock[] = [];
    for (const lock of locks.values()) {
      if (lock.expiresAt <= t) locks.delete(lock.token);
      else if (lock.userId === userId) result.push(lock);
    }
    return result;
  }

  function conflict(blocking: Lock[]): DavError {
    return new DavError(
      423,
      "lock-token-submitted",
      blocking.map((l) => hrefFor(l.path, false)),
    );
  }

  return {
    assertWritable(userId, path, submitted, scope = {}) {
      const parent = path.slice(0, -1);
      const blocking = live(userId).filter(
        (lock) =>
          !submitted.has(lock.token) &&
          (covers(lock, path) ||
            (scope.membership === true && path.length > 0 && isSamePath(lock.path, parent)) ||
            (scope.subtree === true && isBelow(lock.path, path))),
      );
      if (blocking.length > 0) throw conflict(blocking);
    },

    assertLockable(userId, path, depth) {
      const blocking = live(userId).filter(
        (lock) => covers(lock, path) || (depth === "infinity" && isBelow(lock.path, path)),
      );
      if (blocking.length > 0) throw conflict(blocking);
    },

    create({ userId, path, depth, ownerXml, timeoutSeconds }) {
      if (live(userId).length >= MAX_LOCKS_PER_USER) {
        throw new DavError(503, undefined, [], { "Retry-After": String(DEFAULT_LOCK_SECONDS) });
      }
      const lock: Lock = {
        token: `opaquelocktoken:${crypto.randomUUID()}`,
        userId,
        path: [...path],
        depth,
        ownerXml,
        timeoutSeconds,
        expiresAt: now() + timeoutSeconds * 1000,
      };
      locks.set(lock.token, lock);
      return lock;
    },

    holds(userId, path, token) {
      const parent = path.slice(0, -1);
      return live(userId).some(
        (lock) =>
          lock.token === token &&
          (covers(lock, path) ||
            (path.length > 0 && isSamePath(lock.path, parent)) ||
            isBelow(lock.path, path)),
      );
    },

    find(userId, path, token) {
      return live(userId).find((lock) => lock.token === token && covers(lock, path));
    },

    refresh(lock, timeoutSeconds) {
      lock.timeoutSeconds = Math.min(timeoutSeconds, MAX_LOCK_SECONDS);
      lock.expiresAt = now() + lock.timeoutSeconds * 1000;
      return lock;
    },

    remove(lock) {
      locks.delete(lock.token);
    },

    discover(userId, path) {
      return live(userId).filter((lock) => covers(lock, path));
    },

    removeUnder(userId, path) {
      for (const lock of live(userId)) {
        if (isSamePath(lock.path, path) || isBelow(lock.path, path)) locks.delete(lock.token);
      }
    },
  };
}

/** The <D:activelock> element for a lock (RFC 4918 section 14.1). */
export function activeLockXml(lock: Lock): string {
  return (
    "<D:activelock>" +
    "<D:locktype><D:write/></D:locktype>" +
    "<D:lockscope><D:exclusive/></D:lockscope>" +
    `<D:depth>${lock.depth}</D:depth>` +
    (lock.ownerXml !== undefined ? `<D:owner>${lock.ownerXml}</D:owner>` : "") +
    `<D:timeout>Second-${lock.timeoutSeconds}</D:timeout>` +
    `<D:locktoken><D:href>${escapeText(lock.token)}</D:href></D:locktoken>` +
    `<D:lockroot><D:href>${escapeText(hrefFor(lock.path, false))}</D:href></D:lockroot>` +
    "</D:activelock>"
  );
}
