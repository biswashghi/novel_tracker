import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

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
      id: "novel-tracker@bghimire.com",
      strict_min_version: "140.0",
      data_collection_permissions: {
        required: ["none"],
        optional: ["authenticationInfo", "personallyIdentifyingInfo", "browsingActivity", "websiteContent"]
      }
    },
    gecko_android: { strict_min_version: "142.0" }
  };
}
if (target === "safari") {
  manifest.permissions = manifest.permissions.filter((permission) => permission !== "identity");
  if (!manifest.permissions.includes("nativeMessaging")) manifest.permissions.push("nativeMessaging");
  manifest.background = { service_worker: "background.js" };
  manifest.browser_specific_settings = {
    safari: { strict_min_version: "17.0" }
  };
  await bundle({
    entryPoints: [path.join(srcDir, "background.js")],
    outfile: path.join(distDir, "background.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "safari17",
    legalComments: "none"
  });
}
if (!new Set(["chrome", "firefox", "safari"]).has(target)) {
  throw new Error(`Unsupported build target: ${target}`);
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`Built ${target} extension to ${distDir}`);
