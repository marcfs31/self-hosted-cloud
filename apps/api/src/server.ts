import { readFileSync } from "node:fs";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const config = loadConfig(process.env);
const app = createApp({ config, version });

app.listen(config.port, () => {
  console.log(`api ${version} listening on :${config.port}`);
});
