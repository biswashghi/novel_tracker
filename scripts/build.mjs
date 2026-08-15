import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");
const target = process.argv.find((argument) => argument.startsWith("--target="))?.split("=")[1] || "chrome";
const distDir = path.join(root, target === "chrome" ? "dist" : `dist-${target}`);

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, "scripts", "generate-icons.mjs")], {
    cwd: root,
    stdio: "inherit"
  });

  child.on("exit", (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`Icon generation failed with code ${code}`));
  });
  child.on("error", reject);
});

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(srcDir, distDir, { recursive: true });

const manifestPath = path.join(distDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.version = pkg.version;
if (target === "firefox") {
  manifest.background = { scripts: ["background.js"], type: "module" };
  manifest.browser_specific_settings = {
    gecko: {
      id: "novel-tracker@noveltracker.app",
      strict_min_version: "128.0",
      data_collection_permissions: { required: ["none"] }
    },
    gecko_android: {}
  };
}
if (!new Set(["chrome", "firefox", "safari"]).has(target)) {
  throw new Error(`Unsupported build target: ${target}`);
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`Built ${target} extension to ${distDir}`);
