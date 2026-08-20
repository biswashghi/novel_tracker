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

// .github/workflows/pr.yml passes these through to keep PR validation
// builds distinct from a real release's version (see AGENTS.md —
// Versioning); production packaging gets neither and uses pkg.version as
// before. Passed straight through to build.mjs, which does the actual
// substitution — without forwarding them here too, this script's own
// internal build.mjs call would silently redo the build with the
// production version, discarding whatever the caller asked for.
const versionOverride = process.argv.find((argument) => argument.startsWith("--version-override="))?.split("=")[1];
const versionName = process.argv.find((argument) => argument.startsWith("--version-name="))?.split("=")[1];
const effectiveVersion = versionOverride || pkg.version;

const buildArgs = [path.join(root, "scripts", "build.mjs")];
if (versionOverride) buildArgs.push(`--version-override=${versionOverride}`);
if (versionName) buildArgs.push(`--version-name=${versionName}`);
await run(process.execPath, buildArgs);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.version !== effectiveVersion) {
  throw new Error(`Manifest version ${manifest.version} does not match expected version ${effectiveVersion}`);
}

for (const size of ["16", "32", "48", "128"]) {
  await assertFile(path.join(distDir, "icons", `icon-${size}.png`));
}

await mkdir(releaseDir, { recursive: true });
const zipName = `${pkg.name}-${effectiveVersion}.zip`;
const zipPath = path.join(releaseDir, zipName);
await rm(zipPath, { force: true });

await run("zip", ["-r", zipPath, "."], {
  cwd: distDir
});

console.log(`Created Chrome Web Store package at ${zipPath}`);
