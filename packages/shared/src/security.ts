import { z } from "zod";
import { meResponse } from "./auth.js";

/*
 * Security contract. All under /api.
 *
 * Login with a second factor:
 *   POST /auth/login → LoginResponse. If the user has TOTP enabled, the password step returns
 *     { mfaRequired: true } and sets a session whose second factor is still pending. A pending
 *     session may only call /auth/login/totp, /auth/logout and /auth/me (which answers
 *     401 mfa_required); everything else answers 401 mfa_required.
 *   POST /auth/login/totp   TotpLoginRequest → MeResponse (6-digit code, ±1 step, or a one-time
 *     recovery code; wrong → 401 invalid_code; rate-limited → 429 too_many_attempts)
 *
 * Passkeys (WebAuthn via @simplewebauthn; RP ID = hostname of PUBLIC_ORIGIN, origin = PUBLIC_ORIGIN;
 * challenges are single-use and expire after 5 minutes):
 *   POST   /auth/passkeys/register/options → WebAuthn creation options JSON (session)
 *   POST   /auth/passkeys/register/verify  RegisterPasskeyRequest → Passkey (201)
 *   GET    /auth/passkeys                  → PasskeyList
 *   DELETE /auth/passkeys/:id              → 204
 *   POST   /auth/passkeys/login/options    → WebAuthn request options JSON (public, discoverable)
 *   POST   /auth/passkeys/login/verify     PasskeyLoginRequest → MeResponse (a passkey satisfies
 *            the second factor; failure → 401 invalid_credentials)
 *
 * TOTP (RFC 6238, SHA-1, 6 digits, 30 s; secret stored server-side):
 *   GET    /auth/totp                      → TotpStatus
 *   POST   /auth/totp/setup                → TotpSetupResponse (pending until enabled)
 *   POST   /auth/totp/enable               TotpEnableRequest → RecoveryCodesResponse (codes shown once,
 *            stored hashed, each single-use)
 *   POST   /auth/totp/disable              TotpDisableRequest → 204 (needs password + current code)
 *   POST   /admin/users/:id/reset-mfa      → 204 (admin; removes TOTP and recovery codes; not on self)
 *
 * App passwords (for CLI, WebDAV, desktop sync):
 *   GET    /auth/app-passwords             → AppPasswordList
 *   POST   /auth/app-passwords             CreateAppPasswordRequest → CreatedAppPasswordResponse (201; token once)
 *   DELETE /auth/app-passwords/:id         → 204
 *   Use: `Authorization: Bearer <token>` on /api/*. Bearer requests are exempt from the Origin
 *   check (no cookies involved) but can never reach /auth/* (except GET /auth/me) or /admin/* —
 *   those answer 404 not_found. Tokens look like `cloud_<43 base64url chars>`; stored as SHA-256;
 *   lastUsedAt updated at most once a minute.
 *
 * Activity log (append-only; written in the same transaction as the action it records):
 *   GET    /activity?cursor=&limit=        → ActivityPage (own events, newest first)
 *   GET    /admin/activity?cursor=&limit=  → ActivityPage (security events of all users, with email)
 */

export const loginResponse = z.union([meResponse, z.object({ mfaRequired: z.literal(true) })]);
export type LoginResponse = z.infer<typeof loginResponse>;

export const totpLoginRequest = z.object({ code: z.string().trim().min(6).max(32) });
export type TotpLoginRequest = z.input<typeof totpLoginRequest>;

export const passkeyName = z.string().trim().min(1).max(60);

export const registerPasskeyRequest = z.object({
  name: passkeyName,
  /** RegistrationResponseJSON from @simplewebauthn/browser, validated by the server library. */
  response: z.record(z.string(), z.unknown()),
});
export type RegisterPasskeyRequest = z.input<typeof registerPasskeyRequest>;

export const passkeyLoginRequest = z.object({
  /** AuthenticationResponseJSON from @simplewebauthn/browser. */
  response: z.record(z.string(), z.unknown()),
});
export type PasskeyLoginRequest = z.input<typeof passkeyLoginRequest>;

export const passkey = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type Passkey = z.infer<typeof passkey>;

export const passkeyList = z.object({ passkeys: z.array(passkey) });
export type PasskeyList = z.infer<typeof passkeyList>;

export const totpStatus = z.object({
  enabled: z.boolean(),
  recoveryCodesLeft: z.int().nonnegative(),
});
export type TotpStatus = z.infer<typeof totpStatus>;

export const totpSetupResponse = z.object({ secret: z.string(), otpauthUrl: z.string() });
export type TotpSetupResponse = z.infer<typeof totpSetupResponse>;

export const totpEnableRequest = z.object({ code: z.string().regex(/^\d{6}$/) });
export type TotpEnableRequest = z.input<typeof totpEnableRequest>;

export const recoveryCodesResponse = z.object({ recoveryCodes: z.array(z.string()).length(10) });
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponse>;

export const totpDisableRequest = z.object({
  password: z.string().min(1).max(1024),
  code: z.string().trim().min(6).max(32),
});
export type TotpDisableRequest = z.input<typeof totpDisableRequest>;

export const appPassword = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type AppPassword = z.infer<typeof appPassword>;

export const appPasswordList = z.object({ appPasswords: z.array(appPassword) });
export type AppPasswordList = z.infer<typeof appPasswordList>;

export const createAppPasswordRequest = z.object({ name: z.string().trim().min(1).max(60) });
export type CreateAppPasswordRequest = z.input<typeof createAppPasswordRequest>;

export const createdAppPasswordResponse = z.object({ appPassword, token: z.string() });
export type CreatedAppPasswordResponse = z.infer<typeof createdAppPasswordResponse>;

export const activityType = z.enum([
  "login_succeeded",
  "login_failed",
  "logout",
  "passkey_added",
  "passkey_removed",
  "totp_enabled",
  "totp_disabled",
  "mfa_reset_by_admin",
  "app_password_created",
  "app_password_revoked",
  "upload",
  "trash",
  "restore",
  "purge",
  "share_created",
  "share_revoked",
]);
export type ActivityType = z.infer<typeof activityType>;

/** Types an admin sees for every user. */
export const SECURITY_ACTIVITY_TYPES: readonly ActivityType[] = [
  "login_succeeded",
  "login_failed",
  "passkey_added",
  "passkey_removed",
  "totp_enabled",
  "totp_disabled",
  "mfa_reset_by_admin",
  "app_password_created",
  "app_password_revoked",
];

export const activityEvent = z.object({
  id: z.string(),
  type: activityType,
  createdAt: z.iso.datetime(),
  ip: z.string().nullable(),
  /** Only on /admin/activity. */
  userEmail: z.string().nullable(),
  fileId: z.string().nullable(),
  /** Small, non-secret context such as a file or device name. Never tokens or passwords. */
  detail: z.record(z.string(), z.string()),
});
export type ActivityEvent = z.infer<typeof activityEvent>;

export const activityPageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const activityPage = z.object({
  events: z.array(activityEvent),
  nextCursor: z.string().nullable(),
});
export type ActivityPage = z.infer<typeof activityPage>;
