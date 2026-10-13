/*
 * Packages unsigned builds into apps/desktop/out:
 *   pnpm --filter @cloud/desktop package                       the current platform and architecture
 *   pnpm --filter @cloud/desktop package darwin-arm64 win32-x64   chosen targets (any host: the
 *                                  packager downloads the matching Electron build; the app has no
 *                                  native modules, so the one stage serves every target)
 *   pnpm --filter @cloud/desktop package all                   darwin and linux x64+arm64, win32 x64
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

type Target = { platform: "darwin" | "linux" | "win32"; arch: "x64" | "arm64" };

const ALL: readonly Target[] = [
  { platform: "darwin", arch: "arm64" },
  { platform: "darwin", arch: "x64" },
  { platform: "win32", arch: "x64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
];

function find(platform: string, arch: string): Target | undefined {
  return ALL.find((t) => t.platform === platform && t.arch === arch);
}

/** The targets named on the command line ("darwin-arm64", "all"), else the one this host is. */
function targets(args: readonly string[]): Target[] {
  if (args.length === 0) {
    const host = find(process.platform, process.arch);
    if (host === undefined) {
      throw new Error(`Packaging is not supported on ${process.platform}/${process.arch}.`);
    }
    return [host];
  }
  if (args.includes("all")) return [...ALL];
  return args.map((arg) => {
    const [platform = "", arch = ""] = arg.split("-");
    const target = find(platform, arch);
    if (target === undefined) {
      throw new Error(
        `Unknown target "${arg}". Use one of: ${ALL.map((t) => `${t.platform}-${t.arch}`).join(", ")}, all.`,
      );
    }
    return target;
  });
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

const wanted = targets(process.argv.slice(2));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

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

for (const { platform, arch } of wanted) {
  const [built] = await packager({
    dir: stage,
    out: outDir,
    name: "Cloud",
    platform,
    arch,
    appBundleId: "cloud.selfhosted.desktop",
    appCopyright: "Self-Hosted Cloud",
    // The packager picks the extension the target needs (.icns, .ico) from this base path.
    icon: join(appDir, "assets", "icon"),
    darwinDarkModeSupport: true,
    // A menu-bar app: no Dock icon.
    extendInfo: { LSUIElement: true },
    asar: false,
    prune: false,
    overwrite: true,
    quiet: true,
  });
  if (built === undefined)
    throw new Error(`The packager produced nothing for ${platform}-${arch}.`);
  cpSync(join(appDir, "assets", "cloud.svg"), join(built, "cloud.svg"));
  const megabytes = (sizeOf(built) / (1024 * 1024)).toFixed(1);
  console.log(`packaged (unsigned): ${built} (${megabytes} MB)`);
}
rmSync(stage, { recursive: true, force: true });
