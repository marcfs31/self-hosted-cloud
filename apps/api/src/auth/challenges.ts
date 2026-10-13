import { randomBytes } from "node:crypto";

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 10_000;

export type ChallengePurpose = "register" | "login";

interface Entry {
  challenge: string;
  purpose: ChallengePurpose;
  userId: string | null;
  expiresAt: number;
}

/**
 * WebAuthn challenges, in memory (a restart only costs a user one retry). An entry is keyed by
 * a random id that travels in a short-lived cookie, and is consumed by the first lookup.
 */
export interface ChallengeStore {
  put(purpose: ChallengePurpose, userId: string | null, challenge: string): string;
  /** Returns the challenge and deletes it; null if unknown, expired, or for another purpose/user. */
  take(id: string | undefined, purpose: ChallengePurpose, userId: string | null): string | null;
}

export function createChallengeStore(now: () => number): ChallengeStore {
  const entries = new Map<string, Entry>();

  function sweep(): void {
    const current = now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= current) entries.delete(id);
    }
  }

  return {
    put(purpose, userId, challenge) {
      if (entries.size >= MAX_PENDING) {
        sweep();
        // Still full of live entries (someone is spraying /login/options): drop the oldest.
        while (entries.size >= MAX_PENDING) {
          const oldest = entries.keys().next();
          if (oldest.done) break;
          entries.delete(oldest.value);
        }
      }
      const id = randomBytes(24).toString("base64url");
      entries.set(id, { challenge, purpose, userId, expiresAt: now() + CHALLENGE_TTL_MS });
      return id;
    },

    take(id, purpose, userId) {
      if (!id) return null;
      const entry = entries.get(id);
      if (!entry) return null;
      entries.delete(id);
      if (entry.expiresAt <= now() || entry.purpose !== purpose || entry.userId !== userId) {
        return null;
      }
      return entry.challenge;
    },
  };
}
