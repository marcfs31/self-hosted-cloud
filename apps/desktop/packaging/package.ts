/*
 * Packages an unsigned build for the current platform into apps/desktop/out:
 *   pnpm --filter @cloud/desktop package
 * Stages the app with its production dependencies only (pnpm deploy, which materialises the
 * workspace package @cloud/shared), then hands the stage to @electron/packager. The stage lives
 * in out/, which is git-ignored.
 */
import { execFileSync } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(appDir, "out");
const stage = join(outDir, ".stage");

function target(): { platform: "darwin" | "linux" | "win32"; arch: "x64" | "arm64" } {
  const { platform, arch } = process;
  if (
    (platform === "darwin" || platform === "linux" || platform === "win32") &&
    (arch === "x64" || arch === "arm64")
  ) {
    return { platform, arch };
  }
  throw new Error(`Packaging is not supported on ${platform}/${arch}.`);
}

function pnpm(args: string[]): void {
  execFileSync("pnpm", args, {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

/** Bytes on disk without following links (the staged node_modules is full of them). */
function sizeOf(path: string): number {
  const info = lstatSync(path);
  if (!info.isDirectory()) return info.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

/** The stage must be self-contained: fail if any link in it leads outside. */
function sealStage(dir: string): void {
  const root = resolve(stage) + sep;
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (lstatSync(path).isSymbolicLink()) {
        const target = resolve(dirname(path), readlinkSync(path));
        if (!(target + sep).startsWith(root)) throw new Error(`${path} points outside the stage`);
      } else if (lstatSync(path).isDirectory()) {
        walk(path);
      }
    }
  };
  walk(dir);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

pnpm(["--filter", "@cloud/shared", "build"]);
// Hoisted: flat, real directories. The packager copies symlinks as plain copies, which would cut
// every package off from its own dependencies in pnpm's default layout.
pnpm([
  "--filter",
  "@cloud/desktop",
  "--config.node-linker=hoisted",
  "deploy",
  "--prod",
  "--legacy",
  stage,
]);
sealStage(stage);

const [built] = await packager({
  dir: stage,
  out: outDir,
  name: "Cloud",
  ...target(),
  appBundleId: "cloud.selfhosted.desktop",
  appCopyright: "Self-Hosted Cloud",
  darwinDarkModeSupport: true,
  // A menu-bar app: no Dock icon.
  extendInfo: { LSUIElement: true },
  asar: false,
  prune: false,
  overwrite: true,
  quiet: true,
});
if (built === undefined) throw new Error("The packager produced nothing.");

rmSync(stage, { recursive: true, force: true });
cpSync(join(appDir, "assets", "cloud.svg"), join(built, "cloud.svg"));
const megabytes = (sizeOf(built) / (1024 * 1024)).toFixed(1);
console.log(`packaged (unsigned): ${built} (${megabytes} MB)`);
