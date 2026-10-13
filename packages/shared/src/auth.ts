import { z } from "zod";

/*
 * Auth and admin contract (all JSON, all under /api):
 *
 *   GET    /auth/setup            → SetupStatusResponse            (public)
 *   POST   /auth/setup            SetupRequest → MeResponse        (public, only while no users exist; sets session)
 *   POST   /auth/login            LoginRequest → MeResponse        (public, rate-limited; sets session)
 *   POST   /auth/register         RegisterRequest → MeResponse     (public, needs a valid invite; sets session)
 *   POST   /auth/logout           → 204                            (session)
 *   GET    /auth/me               → MeResponse                     (session)
 *
 *   GET    /admin/users           → ListUsersResponse              (admin; includes usedBytes)
 *   PATCH  /admin/users/:id       UpdateUserRequest → User  (admin; not on self)
 *   GET    /admin/invites         → ListInvitesResponse            (admin)
 *   POST   /admin/invites         CreateInviteRequest → CreatedInviteResponse (admin; token shown once)
 *   DELETE /admin/invites/:id     → 204                            (admin)
 *
 * Session: opaque token in the `sid` cookie (HttpOnly, SameSite=Lax, Secure in production).
 * Every state-changing request must carry an Origin header equal to PUBLIC_ORIGIN.
 * A non-admin calling /admin/* gets `not_found`.
 */

export const GIB = 1024 ** 3;
export const DEFAULT_QUOTA_BYTES = 100 * GIB;

export const emailField = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
export const newPasswordField = z.string().min(12).max(1024);

export const role = z.enum(["admin", "member"]);
export type Role = z.infer<typeof role>;

export const user = z.object({
  id: z.string(),
  email: z.string(),
  role,
  quotaBytes: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof user>;

export const setupStatusResponse = z.object({ needsSetup: z.boolean() });
export type SetupStatusResponse = z.infer<typeof setupStatusResponse>;

export const setupRequest = z.object({ email: emailField, password: newPasswordField });
export type SetupRequest = z.input<typeof setupRequest>;

export const loginRequest = z.object({
  email: emailField,
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.input<typeof loginRequest>;

export const registerRequest = z.object({
  token: z.string().min(1).max(200),
  email: emailField,
  password: newPasswordField,
});
export type RegisterRequest = z.input<typeof registerRequest>;

export const changePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: newPasswordField,
});
export type ChangePasswordRequest = z.input<typeof changePasswordRequest>;

export const meResponse = z.object({ user });
export type MeResponse = z.infer<typeof meResponse>;

export const userSummary = user.extend({ usedBytes: z.number().int().nonnegative() });
export type UserSummary = z.infer<typeof userSummary>;

export const listUsersResponse = z.object({ users: z.array(userSummary) });
export type ListUsersResponse = z.infer<typeof listUsersResponse>;

export const updateUserRequest = z
  .object({
    quotaBytes: z.number().int().nonnegative().optional(),
    role: role.optional(),
  })
  .refine((v) => v.quotaBytes !== undefined || v.role !== undefined);
export type UpdateUserRequest = z.input<typeof updateUserRequest>;

export const createInviteRequest = z.object({
  role: role.default("member"),
  expiresInDays: z.int().min(1).max(30).default(7),
});
export type CreateInviteRequest = z.input<typeof createInviteRequest>;

export const invite = z.object({
  id: z.string(),
  role,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  usedAt: z.iso.datetime().nullable(),
});
export type Invite = z.infer<typeof invite>;

export const createdInviteResponse = z.object({ invite, token: z.string() });
export type CreatedInviteResponse = z.infer<typeof createdInviteResponse>;

export const listInvitesResponse = z.object({ invites: z.array(invite) });
export type ListInvitesResponse = z.infer<typeof listInvitesResponse>;
