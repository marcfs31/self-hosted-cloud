import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: node scripts/set-version.ts X.Y.Z");
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const manifests = ["package.json"];
for (const dir of ["apps", "packages"]) {
  for (const name of readdirSync(join(root, dir))) manifests.push(join(dir, name, "package.json"));
}

for (const path of manifests) {
  const file = join(root, path);
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace(/"version": "[^"]+"/, `"version": "${version}"`));
}
console.log(`set ${version} in ${manifests.length} manifests`);
