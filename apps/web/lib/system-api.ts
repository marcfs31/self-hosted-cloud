import type { SystemStatus } from "@cloud/shared";
import { apiFetch } from "./api";

/** GET /admin/system. Admin only; anyone else gets a 404 ApiError (not_found). */
export function getSystemStatus(signal?: AbortSignal): Promise<SystemStatus> {
  return apiFetch<SystemStatus>("/admin/system", signal ? { signal } : {});
}
