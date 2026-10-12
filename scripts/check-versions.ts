import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): { name: string; version: string } =>
  JSON.parse(readFileSync(join(root, path), "utf8")) as { name: string; version: string };

const manifests = ["package.json"];
for (const dir of ["apps", "packages"]) {
  for (const name of readdirSync(join(root, dir))) manifests.push(join(dir, name, "package.json"));
}

const expected = read("package.json").version;
const mismatched = manifests
  .map((path) => ({ path, version: read(path).version }))
  .filter((m) => m.version !== expected);

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const problems = mismatched.map((m) => `${m.path} is ${m.version}, expected ${expected}`);
if (expected !== "0.0.0" && !changelog.includes(`## [${expected}]`)) {
  problems.push(`CHANGELOG.md has no "## [${expected}]" section`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`versions ok: ${expected} in ${manifests.length} manifests`);
