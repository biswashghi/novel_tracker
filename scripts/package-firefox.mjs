import { mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist-firefox");
const releaseDir = path.join(root, "release");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`)));
    child.on("error", reject);
  });
}

await run(process.execPath, [path.join(root, "scripts", "build.mjs"), "--target=firefox"]);

const manifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
const gecko = manifest.browser_specific_settings?.gecko;
if (manifest.version !== pkg.version) throw new Error("Firefox manifest version does not match package version");
if (gecko?.id !== "novel-tracker@bghimire.com") throw new Error("Firefox package is missing its stable add-on ID");
if (!manifest.browser_specific_settings?.gecko_android) throw new Error("Firefox Android compatibility is not declared");

await mkdir(releaseDir, { recursive: true });
const zipPath = path.join(releaseDir, `${pkg.name}-firefox-${pkg.version}.zip`);
await rm(zipPath, { force: true });
await run("zip", ["-r", zipPath, ".", "-x", "*.DS_Store", "__MACOSX/*"], distDir);

console.log(`Created Firefox AMO package at ${zipPath}`);
