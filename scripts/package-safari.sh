#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
npm --prefix "$root_dir" run build:safari
stage_dir="$(mktemp -d /tmp/novel-tracker-safari-extension.XXXXXX)"
project_dir="$(mktemp -d /tmp/novel-tracker-safari-project.XXXXXX)"
trap 'rm -rf "$stage_dir" "$project_dir"' EXIT
node --input-type=module -e '
  import { cp, readFile, writeFile } from "node:fs/promises";
  const [source, destination] = process.argv.slice(1);
  await cp(source, destination, { recursive: true });
  const manifestPath = `${destination}/manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
' "$root_dir/dist-safari" "$stage_dir"
xcrun safari-web-extension-converter "$stage_dir" \
  --app-name "Novel Tracker" \
  --bundle-identifier "app.noveltracker.extension" \
  --project-location "$project_dir" \
  --copy-resources \
  --force \
  --no-prompt

generated_app_dir="$project_dir/Novel Tracker"
handler_path="$generated_app_dir/Shared (Extension)/SafariWebExtensionHandler.swift"
cp "$root_dir/safari-native/SafariWebExtensionHandler.swift" "$handler_path"
echo "Installed Safari native OAuth bridge: $handler_path"

version="$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { join } from "node:path";
  const root = process.argv[1];
  process.stdout.write(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
' "$root_dir")"
release_dir="$root_dir/release"
archive_path="$release_dir/novel-tracker-safari-xcode-$version.zip"
mkdir -p "$release_dir"
rm -f "$archive_path"
ditto -c -k --norsrc --keepParent "$generated_app_dir" "$archive_path"

echo "Packaged Safari Xcode project: $archive_path"
echo "The generated project is staged temporarily, so existing local Xcode signing settings are not overwritten."
