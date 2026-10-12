import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 defaults: Argon2id, 19 MiB memory, 2 passes, 1 lane (OWASP minimum).
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies against the stored hash, or against a fixed dummy hash when the user
 * does not exist, so unknown emails cost the same time as wrong passwords.
 */
export async function verifyPassword(
  storedHash: string | undefined,
  password: string,
): Promise<boolean> {
  dummyHash ??= hash("dummy-password-for-timing-equalisation");
  const ok = await verify(storedHash ?? (await dummyHash), password);
  return storedHash !== undefined && ok;
}
