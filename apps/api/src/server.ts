import { readFileSync } from "node:fs";
import { createApp } from "./app.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const port = Number(process.env.PORT ?? 4000);
const app = createApp({ version });

app.listen(port, () => {
  console.log(`api listening on :${port}`);
});
