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
app_controller_path="$generated_app_dir/Shared (App)/ViewController.swift"
cp "$root_dir/safari-native/SafariAppViewController.swift" "$app_controller_path"
echo "Installed Safari native authentication and session bridge"

shared_keychain_group='$(AppIdentifierPrefix)app.noveltracker.shared'
for target in "iOS (App)" "iOS (Extension)" "macOS (Extension)"; do
  entitlements_path="$generated_app_dir/$target/NovelTracker.entitlements"
  /usr/libexec/PlistBuddy -c 'Add :keychain-access-groups array' "$entitlements_path"
  /usr/libexec/PlistBuddy -c "Add :keychain-access-groups:0 string $shared_keychain_group" "$entitlements_path"
  info_path="$generated_app_dir/$target/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :NovelTrackerKeychainAccessGroup string $shared_keychain_group" "$info_path"
done

ios_app_info="$generated_app_dir/iOS (App)/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes array' "$ios_app_info"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0 dict' "$ios_app_info"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLName string app.noveltracker.oauth' "$ios_app_info"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' "$ios_app_info"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string noveltracker' "$ios_app_info"

node --input-type=module -e '
  import { readFile, writeFile } from "node:fs/promises";
  const projectPath = process.argv[1];
  let project = await readFile(projectPath, "utf8");
  const entitlementByInfo = new Map([
    ["iOS (App)/Info.plist", "iOS (App)/NovelTracker.entitlements"],
    ["iOS (Extension)/Info.plist", "iOS (Extension)/NovelTracker.entitlements"],
    ["macOS (Extension)/Info.plist", "macOS (Extension)/NovelTracker.entitlements"]
  ]);
  for (const [info, entitlement] of entitlementByInfo) {
    const escaped = info.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const marker = new RegExp(`(GENERATE_INFOPLIST_FILE = YES;\\n)(\\s+)(INFOPLIST_FILE = "${escaped}";)`, "g");
    let matches = 0;
    project = project.replace(marker, (_match, generated, indent, plist) => {
      matches += 1;
      return `CODE_SIGN_ENTITLEMENTS = "${entitlement}";\n${indent}${generated}${indent}${plist}`;
    });
    if (matches !== 2) throw new Error(`Expected two configurations for ${info}, found ${matches}`);
  }
  const marker = /ENABLE_HARDENED_RUNTIME = YES;\n(\s+)ENABLE_USER_SELECTED_FILES = readonly;\n(\s+)CODE_SIGN_ENTITLEMENTS = "macOS \(Extension\)\/NovelTracker\.entitlements";\n(\s+)GENERATE_INFOPLIST_FILE = YES;\n(\s+)INFOPLIST_FILE = "macOS \(Extension\)\/Info\.plist";/g;
  let replacements = 0;
  project = project.replace(marker, (_match, indent1, indent2, indent3, indent4) => {
    replacements += 1;
    return `ENABLE_HARDENED_RUNTIME = YES;\n${indent1}ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES;\n${indent1}ENABLE_USER_SELECTED_FILES = readonly;\n${indent2}CODE_SIGN_ENTITLEMENTS = "macOS (Extension)/NovelTracker.entitlements";\n${indent3}GENERATE_INFOPLIST_FILE = YES;\n${indent4}INFOPLIST_FILE = "macOS (Extension)/Info.plist";`;
  });
  if (replacements !== 2) throw new Error(`Expected two macOS extension configurations, found ${replacements}`);
  await writeFile(projectPath, project);
' "$generated_app_dir/Novel Tracker.xcodeproj/project.pbxproj"
echo "Enabled outbound networking for the macOS Safari extension target"

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
