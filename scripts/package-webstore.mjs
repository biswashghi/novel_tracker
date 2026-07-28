import { mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const releaseDir = path.join(root, "release");
const packageJsonPath = path.join(root, "package.json");
const manifestPath = path.join(distDir, "manifest.json");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      ...options
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function assertFile(pathname) {
  await readFile(pathname);
}

const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));

await run(process.execPath, [path.join(root, "scripts", "build.mjs")]);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.version !== pkg.version) {
  throw new Error(`Manifest version ${manifest.version} does not match package version ${pkg.version}`);
}

for (const size of ["16", "32", "48", "128"]) {
  await assertFile(path.join(distDir, "icons", `icon-${size}.png`));
}

await mkdir(releaseDir, { recursive: true });
const zipName = `${pkg.name}-${pkg.version}.zip`;
const zipPath = path.join(releaseDir, zipName);
await rm(zipPath, { force: true });

await run("zip", ["-r", zipPath, "."], {
  cwd: distDir
});

console.log(`Created Chrome Web Store package at ${zipPath}`);
