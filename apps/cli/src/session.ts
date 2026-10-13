import { ApiClient } from "./client.js";
import { loadConfig, type StoredConfig } from "./config.js";
import { CliError, EXIT } from "./errors.js";
import type { Io } from "./io.js";

export interface Session {
  config: StoredConfig;
  client: ApiClient;
}

/** The stored login as a ready client; commands that need the server start here. */
export async function openSession(io: Io): Promise<Session> {
  const config = await loadConfig(io);
  if (config === null) {
    throw new CliError(
      "You are not logged in. Run 'cloud login' first.",
      EXIT.auth,
      "not_logged_in",
    );
  }
  return { config, client: new ApiClient(config.server, config.token) };
}
