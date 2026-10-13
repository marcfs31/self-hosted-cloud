import { z } from "zod";

/**
 * Every error the API can return. The API never sends free-text messages;
 * the web maps each code to copy in apps/web/lib/messages.ts.
 */
export const errorCode = z.enum([
  "invalid_request",
  "unauthenticated",
  "not_found",
  "origin_rejected",
  "too_many_attempts",
  "setup_already_done",
  "invalid_credentials",
  "invite_invalid",
  "email_taken",
  "cannot_change_self",
  "name_conflict",
  "invalid_move",
  "quota_exceeded",
  "version_is_current",
  "share_locked",
  "internal",
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const errorResponse = z.object({
  error: z.object({ code: errorCode }),
});
export type ErrorResponse = z.infer<typeof errorResponse>;
