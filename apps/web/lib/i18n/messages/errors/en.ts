import type { ErrorCode } from "@cloud/shared";
import type { Widen } from "../../types";

export const en: Record<ErrorCode, string> = {
  invalid_request: "Some of the details don't look right. Please check them and try again.",
  unauthenticated: "Your session has ended. Please log in again.",
  not_found: "We couldn't find that. It may have been removed.",
  origin_rejected:
    "This request didn't come from the page it should have. Reload the page and try again.",
  too_many_attempts: "Too many attempts for now. Please wait a few minutes and try again.",
  setup_already_done: "This cloud is already set up. Log in instead.",
  invalid_credentials: "That email and password don't match. Please try again.",
  invite_invalid: "This invite link isn't valid any more. Ask the admin for a new one.",
  email_taken: "An account with that email already exists.",
  cannot_change_self: "You can't change your own account here.",
  name_conflict: "Something with that name is already here. Choose another name.",
  invalid_move: "That item can't be moved or changed this way.",
  quota_exceeded: "There isn't enough space left in your storage for this.",
  version_is_current: "This is the current version. Restore another version first.",
  internal: "Something went wrong on our side. Please try again in a moment.",
};

export type Errors = Widen<typeof en>;
