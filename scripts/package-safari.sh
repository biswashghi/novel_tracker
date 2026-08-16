
#!/usr/bin/env bash
set -euo pipefail

apple_team_id="3LQK7JJTX2"

root_dir="$(cd "$(dirname "$0")/.." && pwd)"

echo "Building Safari extension..."
npm --prefix "$root_dir" run build:safari

# Safari extension staging can remain temporary.
stage_dir="$(mktemp -d /tmp/novel-tracker-safari-extension.XXXXXX)"
trap 'rm -rf "$stage_dir"' EXIT

# Keep the generated Xcode project in a persistent location.
project_dir="$root_dir/build/safari-xcode"

rm -rf "$project_dir"
mkdir -p "$project_dir"

# ---------------------------------------------------------------------------
# Stage WebExtension
# ---------------------------------------------------------------------------

node --input-type=module -e '
  import { cp, readFile, writeFile } from "node:fs/promises";

  const [source, destination] = process.argv.slice(1);

  await cp(source, destination, { recursive: true });

  const manifestPath = `${destination}/manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
' "$root_dir/dist-safari" "$stage_dir"

# ---------------------------------------------------------------------------
# Generate Xcode project
# ---------------------------------------------------------------------------

echo "Generating Safari Xcode project..."

xcrun safari-web-extension-converter "$stage_dir" \
  --app-name "Novel Tracker" \
  --bundle-identifier "app.noveltracker.extension" \
  --project-location "$project_dir" \
  --copy-resources \
  --force \
  --no-prompt

generated_app_dir="$project_dir/Novel Tracker"
xcode_project="$generated_app_dir/Novel Tracker.xcodeproj/project.pbxproj"
xcode_project_bundle="$generated_app_dir/Novel Tracker.xcodeproj"

# ---------------------------------------------------------------------------
# Install custom native Swift bridge
# ---------------------------------------------------------------------------

handler_path="$generated_app_dir/Shared (Extension)/SafariWebExtensionHandler.swift"

cp \
  "$root_dir/safari-native/SafariWebExtensionHandler.swift" \
  "$handler_path"

app_controller_path="$generated_app_dir/Shared (App)/ViewController.swift"

cp \
  "$root_dir/safari-native/SafariAppViewController.swift" \
  "$app_controller_path"

echo "Installed Safari native authentication and session bridge"

# Verify the correct handler was copied.
if ! grep -q 'novel-tracker.auth.get' "$handler_path"; then
  echo "ERROR: Generated Safari handler does not contain authentication bridge"
  exit 1
fi

# ---------------------------------------------------------------------------
# Shared Keychain
# ---------------------------------------------------------------------------

shared_keychain_group='$(AppIdentifierPrefix)app.noveltracker.shared'

for target in \
  "iOS (App)" \
  "iOS (Extension)" \
  "macOS (Extension)"
do
  entitlements_path="$generated_app_dir/$target/NovelTracker.entitlements"

  if /usr/libexec/PlistBuddy \
      -c 'Print :keychain-access-groups' \
      "$entitlements_path" >/dev/null 2>&1
  then
    /usr/libexec/PlistBuddy \
      -c 'Delete :keychain-access-groups' \
      "$entitlements_path"
  fi

  /usr/libexec/PlistBuddy \
    -c 'Add :keychain-access-groups array' \
    "$entitlements_path"

  /usr/libexec/PlistBuddy \
    -c "Add :keychain-access-groups:0 string $shared_keychain_group" \
    "$entitlements_path"

  info_path="$generated_app_dir/$target/Info.plist"

  if /usr/libexec/PlistBuddy \
      -c 'Print :NovelTrackerKeychainAccessGroup' \
      "$info_path" >/dev/null 2>&1
  then
    /usr/libexec/PlistBuddy \
      -c "Set :NovelTrackerKeychainAccessGroup $shared_keychain_group" \
      "$info_path"
  else
    /usr/libexec/PlistBuddy \
      -c "Add :NovelTrackerKeychainAccessGroup string $shared_keychain_group" \
      "$info_path"
  fi
done

echo "Configured shared Keychain access"

# ---------------------------------------------------------------------------
# iOS OAuth callback URL
# ---------------------------------------------------------------------------

ios_app_info="$generated_app_dir/iOS (App)/Info.plist"

if /usr/libexec/PlistBuddy \
    -c 'Print :CFBundleURLTypes' \
    "$ios_app_info" >/dev/null 2>&1
then
  /usr/libexec/PlistBuddy \
    -c 'Delete :CFBundleURLTypes' \
    "$ios_app_info"
fi

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes array' \
  "$ios_app_info"

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes:0 dict' \
  "$ios_app_info"

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes:0:CFBundleURLName string app.noveltracker.oauth' \
  "$ios_app_info"

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' \
  "$ios_app_info"

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string noveltracker' \
  "$ios_app_info"

echo "Configured iOS OAuth callback"

# ---------------------------------------------------------------------------
# macOS App Store metadata
# ---------------------------------------------------------------------------

macos_app_info="$generated_app_dir/macOS (App)/Info.plist"

if /usr/libexec/PlistBuddy \
    -c 'Print :LSApplicationCategoryType' \
    "$macos_app_info" >/dev/null 2>&1
then
  /usr/libexec/PlistBuddy \
    -c 'Set :LSApplicationCategoryType public.app-category.productivity' \
    "$macos_app_info"
else
  /usr/libexec/PlistBuddy \
    -c 'Add :LSApplicationCategoryType string public.app-category.productivity' \
    "$macos_app_info"
fi

echo "Configured macOS App Store category"

# ---------------------------------------------------------------------------
# Patch generated Xcode project
#
# - attach entitlement files
# - enable outbound networking on macOS extension
# - force macOS 11 minimum deployment target
# - force automatic signing
# - force Apple Developer team
# ---------------------------------------------------------------------------

node --input-type=module -e '
  import { readFile, writeFile } from "node:fs/promises";

  const projectPath = process.argv[1];
  const teamID = process.argv[2];

  let project = await readFile(projectPath, "utf8");

  // -----------------------------------------------------------------------
  // Entitlements
  // -----------------------------------------------------------------------

  const entitlementByInfo = new Map([
    [
      "iOS (App)/Info.plist",
      "iOS (App)/NovelTracker.entitlements"
    ],
    [
      "iOS (Extension)/Info.plist",
      "iOS (Extension)/NovelTracker.entitlements"
    ],
    [
      "macOS (Extension)/Info.plist",
      "macOS (Extension)/NovelTracker.entitlements"
    ]
  ]);

  for (const [info, entitlement] of entitlementByInfo) {
    const escaped = info.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const marker = new RegExp(
      `(GENERATE_INFOPLIST_FILE = YES;\\n)(\\s+)(INFOPLIST_FILE = "${escaped}";)`,
      "g"
    );

    let matches = 0;

    project = project.replace(
      marker,
      (_match, generated, indent, plist) => {
        matches += 1;

        return (
          `CODE_SIGN_ENTITLEMENTS = "${entitlement}";\n` +
          `${indent}${generated}` +
          `${indent}${plist}`
        );
      }
    );

    if (matches !== 2) {
      throw new Error(
        `Expected two configurations for ${info}, found ${matches}`
      );
    }
  }

  // -----------------------------------------------------------------------
  // macOS extension outbound networking
  // -----------------------------------------------------------------------

  const networkingMarker =
    /ENABLE_HARDENED_RUNTIME = YES;\n(\s+)ENABLE_USER_SELECTED_FILES = readonly;\n(\s+)CODE_SIGN_ENTITLEMENTS = "macOS \(Extension\)\/NovelTracker\.entitlements";\n(\s+)GENERATE_INFOPLIST_FILE = YES;\n(\s+)INFOPLIST_FILE = "macOS \(Extension\)\/Info\.plist";/g;

  let networkingReplacements = 0;

  project = project.replace(
    networkingMarker,
    (_match, indent1, indent2, indent3, indent4) => {
      networkingReplacements += 1;

      return (
        `ENABLE_HARDENED_RUNTIME = YES;\n` +
        `${indent1}ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES;\n` +
        `${indent1}ENABLE_USER_SELECTED_FILES = readonly;\n` +
        `${indent2}CODE_SIGN_ENTITLEMENTS = "macOS (Extension)/NovelTracker.entitlements";\n` +
        `${indent3}GENERATE_INFOPLIST_FILE = YES;\n` +
        `${indent4}INFOPLIST_FILE = "macOS (Extension)/Info.plist";`
      );
    }
  );

  if (networkingReplacements !== 2) {
    throw new Error(
      `Expected two macOS extension configurations, found ${networkingReplacements}`
    );
  }

  // -----------------------------------------------------------------------
  // macOS deployment target
  // -----------------------------------------------------------------------

  let deploymentTargetReplacements = 0;

  project = project.replace(
    /MACOSX_DEPLOYMENT_TARGET = [^;]+;/g,
    () => {
      deploymentTargetReplacements += 1;
      return "MACOSX_DEPLOYMENT_TARGET = 11.0;";
    }
  );

  if (deploymentTargetReplacements === 0) {
    throw new Error(
      "Could not find any macOS deployment targets to update"
    );
  }

  console.log(
    `Set ${deploymentTargetReplacements} macOS deployment target entries to macOS 11.0`
  );

  // -----------------------------------------------------------------------
  // Automatic signing
  // -----------------------------------------------------------------------

  project = project.replace(
    /^\s*DEVELOPMENT_TEAM = [^;]*;\n/gm,
    ""
  );

  let signingStyleReplacements = 0;

  project = project.replace(
    /^(\s*)CODE_SIGN_STYLE = (?:Automatic|Manual);$/gm,
    (_match, indent) => {
      signingStyleReplacements += 1;

      return (
        `${indent}CODE_SIGN_STYLE = Automatic;\n` +
        `${indent}DEVELOPMENT_TEAM = ${teamID};`
      );
    }
  );

  if (signingStyleReplacements === 0) {
    throw new Error(
      "Could not find CODE_SIGN_STYLE settings in generated Xcode project"
    );
  }

  console.log(
    `Configured automatic signing for Apple team ${teamID} ` +
    `in ${signingStyleReplacements} build configurations`
  );

  // -----------------------------------------------------------------------
  // Final safety checks
  // -----------------------------------------------------------------------

  if (!project.includes(`DEVELOPMENT_TEAM = ${teamID};`)) {
    throw new Error(
      `Apple Developer team ${teamID} was not written to the Xcode project`
    );
  }

  if (!project.includes("MACOSX_DEPLOYMENT_TARGET = 11.0;")) {
    throw new Error(
      "macOS 11 deployment target was not written to the Xcode project"
    );
  }

  if (!project.includes("CODE_SIGN_STYLE = Automatic;")) {
    throw new Error(
      "Automatic code signing was not written to the Xcode project"
    );
  }

  await writeFile(projectPath, project);
' \
  "$xcode_project" \
  "$apple_team_id"

echo "Configured Xcode project:"
echo "  Apple team:        $apple_team_id"
echo "  Signing:           Automatic"
echo "  macOS minimum:     11.0"
echo "  macOS networking:  Enabled"

# ---------------------------------------------------------------------------
# Show resulting configuration
# ---------------------------------------------------------------------------

echo
echo "Signing/build configuration:"

grep -E \
  'DEVELOPMENT_TEAM|CODE_SIGN_STYLE|MACOSX_DEPLOYMENT_TARGET' \
  "$xcode_project" \
  | sort -u

echo

# ---------------------------------------------------------------------------
# Create release ZIP
# ---------------------------------------------------------------------------

version="$(
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { join } from "node:path";

    const root = process.argv[1];

    process.stdout.write(
      JSON.parse(
        readFileSync(
          join(root, "package.json"),
          "utf8"
        )
      ).version
    );
  ' "$root_dir"
)"

release_dir="$root_dir/release"
archive_path="$release_dir/novel-tracker-safari-xcode-$version.zip"

mkdir -p "$release_dir"
rm -f "$archive_path"

ditto \
  -c \
  -k \
  --norsrc \
  --keepParent \
  "$generated_app_dir" \
  "$archive_path"

echo
echo "Safari Xcode project generated successfully."
echo
echo "Xcode project:"
echo "  $xcode_project_bundle"
echo
echo "Release ZIP:"
echo "  $archive_path"
echo
echo "Configuration:"
echo "  Team:                 $apple_team_id"
echo "  Signing style:        Automatic"
echo "  macOS deployment:     11.0"
echo "  App Store category:   Productivity"

# ---------------------------------------------------------------------------
# Optionally open Xcode
# ---------------------------------------------------------------------------

if [[ "${OPEN_XCODE:-0}" == "1" ]]; then
  echo
  echo "Opening Xcode..."
  open "$xcode_project_bundle"
else
  echo
  echo "Run this to open the generated project:"
  echo "  open \"$xcode_project_bundle\""
f
#!/usr/bin/env bash
set -euo pipefail

apple_team_id="3LQK7JJTX2"

root_dir="$(cd "$(dirname "$0")/.." && pwd)"

echo "Building Safari extension..."
npm --prefix "$root_dir" run build:safari

stage_dir="$(mktemp -d /tmp/novel-tracker-safari-extension.XXXXXX)"
project_dir="$(mktemp -d /tmp/novel-tracker-safari-project.XXXXXX)"

trap 'rm -rf "$stage_dir" "$project_dir"' EXIT

# ---------------------------------------------------------------------------
# Stage WebExtension
# ---------------------------------------------------------------------------

node --input-type=module -e '
  import { cp, readFile, writeFile } from "node:fs/promises";

  const [source, destination] = process.argv.slice(1);

  await cp(source, destination, { recursive: true });

  const manifestPath = `${destination}/manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
' "$root_dir/dist-safari" "$stage_dir"

# ---------------------------------------------------------------------------
# Generate Xcode project
# ---------------------------------------------------------------------------

echo "Generating Safari Xcode project..."

xcrun safari-web-extension-converter "$stage_dir" \
  --app-name "Novel Tracker" \
  --bundle-identifier "app.noveltracker.extension" \
  --project-location "$project_dir" \
  --copy-resources \
  --force \
  --no-prompt

generated_app_dir="$project_dir/Novel Tracker"
xcode_project="$generated_app_dir/Novel Tracker.xcodeproj/project.pbxproj"

# ---------------------------------------------------------------------------
# Install custom native Swift bridge
# ---------------------------------------------------------------------------

handler_path="$generated_app_dir/Shared (Extension)/SafariWebExtensionHandler.swift"

cp \
  "$root_dir/safari-native/SafariWebExtensionHandler.swift" \
  "$handler_path"

app_controller_path="$generated_app_dir/Shared (App)/ViewController.swift"

cp \
  "$root_dir/safari-native/SafariAppViewController.swift" \
  "$app_controller_path"

echo "Installed Safari native authentication and session bridge"

# Make sure the correct/new handler actually made it into the generated app.
if ! grep -q 'novel-tracker.auth.get' "$handler_path"; then
  echo "ERROR: Generated Safari handler does not contain authentication bridge"
  exit 1
fi

# ---------------------------------------------------------------------------
# Shared Keychain
# ---------------------------------------------------------------------------

shared_keychain_group='$(AppIdentifierPrefix)app.noveltracker.shared'

for target in \
  "iOS (App)" \
  "iOS (Extension)" \
  "macOS (Extension)"
do
  entitlements_path="$generated_app_dir/$target/NovelTracker.entitlements"

  # Converter may create an empty entitlements file, or PlistBuddy will create
  # one for us if necessary.
  if /usr/libexec/PlistBuddy \
      -c 'Print :keychain-access-groups' \
      "$entitlements_path" >/dev/null 2>&1
  then
    /usr/libexec/PlistBuddy \
      -c 'Delete :keychain-access-groups' \
      "$entitlements_path"
  fi

  /usr/libexec/PlistBuddy \
    -c 'Add :keychain-access-groups array' \
    "$entitlements_path"

  /usr/libexec/PlistBuddy \
    -c "Add :keychain-access-groups:0 string $shared_keychain_group" \
    "$entitlements_path"

  info_path="$generated_app_dir/$target/Info.plist"

  if /usr/libexec/PlistBuddy \
      -c 'Print :NovelTrackerKeychainAccessGroup' \
      "$info_path" >/dev/null 2>&1
  then
    /usr/libexec/PlistBuddy \
      -c "Set :NovelTrackerKeychainAccessGroup $shared_keychain_group" \
      "$info_path"
  else
    /usr/libexec/PlistBuddy \
      -c "Add :NovelTrackerKeychainAccessGroup string $shared_keychain_group" \
      "$info_path"
  fi
done

echo "Configured shared Keychain access"

# ---------------------------------------------------------------------------
# iOS OAuth callback URL
# ---------------------------------------------------------------------------

ios_app_info="$generated_app_dir/iOS (App)/Info.plist"

# Delete old value first so packaging remains idempotent.
if /usr/libexec/PlistBuddy \
    -c 'Print :CFBundleURLTypes' \
    "$ios_app_info" >/dev/null 2>&1
then
  /usr/libexec/PlistBuddy \
    -c 'Delete :CFBundleURLTypes' \
    "$ios_app_info"
fi

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes array' \
  "$ios_app_info"

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes:0 dict' \
  "$ios_app_info"

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes:0:CFBundleURLName string app.noveltracker.oauth' \
  "$ios_app_info"

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' \
  "$ios_app_info"

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string noveltracker' \
  "$ios_app_info"

echo "Configured iOS OAuth callback"

# ---------------------------------------------------------------------------
# macOS App Store metadata
# ---------------------------------------------------------------------------

macos_app_info="$generated_app_dir/macOS (App)/Info.plist"

if /usr/libexec/PlistBuddy \
    -c 'Print :LSApplicationCategoryType' \
    "$macos_app_info" >/dev/null 2>&1
then
  /usr/libexec/PlistBuddy \
    -c 'Set :LSApplicationCategoryType public.app-category.productivity' \
    "$macos_app_info"
else
  /usr/libexec/PlistBuddy \
    -c 'Add :LSApplicationCategoryType string public.app-category.productivity' \
    "$macos_app_info"
fi

echo "Configured macOS App Store category"

# ---------------------------------------------------------------------------
# Patch generated Xcode project
#
# - attach our entitlement files
# - enable outbound networking on macOS extension
# - force macOS 11 minimum deployment target
# - force automatic signing
# - force Apple Developer team
# ---------------------------------------------------------------------------

node --input-type=module -e '
  import { readFile, writeFile } from "node:fs/promises";

  const projectPath = process.argv[1];
  const teamID = process.argv[2];

  let project = await readFile(projectPath, "utf8");

  // -----------------------------------------------------------------------
  // Entitlements
  // -----------------------------------------------------------------------

  const entitlementByInfo = new Map([
    [
      "iOS (App)/Info.plist",
      "iOS (App)/NovelTracker.entitlements"
    ],
    [
      "iOS (Extension)/Info.plist",
      "iOS (Extension)/NovelTracker.entitlements"
    ],
    [
      "macOS (Extension)/Info.plist",
      "macOS (Extension)/NovelTracker.entitlements"
    ]
  ]);

  for (const [info, entitlement] of entitlementByInfo) {
    const escaped = info.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const marker = new RegExp(
      `(GENERATE_INFOPLIST_FILE = YES;\\n)(\\s+)(INFOPLIST_FILE = "${escaped}";)`,
      "g"
    );

    let matches = 0;

    project = project.replace(
      marker,
      (_match, generated, indent, plist) => {
        matches += 1;

        return (
          `CODE_SIGN_ENTITLEMENTS = "${entitlement}";\n` +
          `${indent}${generated}` +
          `${indent}${plist}`
        );
      }
    );

    if (matches !== 2) {
      throw new Error(
        `Expected two configurations for ${info}, found ${matches}`
      );
    }
  }

  // -----------------------------------------------------------------------
  // macOS extension outbound networking
  // -----------------------------------------------------------------------

  const networkingMarker =
    /ENABLE_HARDENED_RUNTIME = YES;\n(\s+)ENABLE_USER_SELECTED_FILES = readonly;\n(\s+)CODE_SIGN_ENTITLEMENTS = "macOS \(Extension\)\/NovelTracker\.entitlements";\n(\s+)GENERATE_INFOPLIST_FILE = YES;\n(\s+)INFOPLIST_FILE = "macOS \(Extension\)\/Info\.plist";/g;

  let networkingReplacements = 0;

  project = project.replace(
    networkingMarker,
    (_match, indent1, indent2, indent3, indent4) => {
      networkingReplacements += 1;

      return (
        `ENABLE_HARDENED_RUNTIME = YES;\n` +
        `${indent1}ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES;\n` +
        `${indent1}ENABLE_USER_SELECTED_FILES = readonly;\n` +
        `${indent2}CODE_SIGN_ENTITLEMENTS = "macOS (Extension)/NovelTracker.entitlements";\n` +
        `${indent3}GENERATE_INFOPLIST_FILE = YES;\n` +
        `${indent4}INFOPLIST_FILE = "macOS (Extension)/Info.plist";`
      );
    }
  );

  if (networkingReplacements !== 2) {
    throw new Error(
      `Expected two macOS extension configurations, found ${networkingReplacements}`
    );
  }

  // -----------------------------------------------------------------------
  // macOS deployment target
  // -----------------------------------------------------------------------

  let deploymentTargetReplacements = 0;

  project = project.replace(
    /MACOSX_DEPLOYMENT_TARGET = [^;]+;/g,
    () => {
      deploymentTargetReplacements += 1;
      return "MACOSX_DEPLOYMENT_TARGET = 11.0;";
    }
  );

  if (deploymentTargetReplacements === 0) {
    throw new Error(
      "Could not find any macOS deployment targets to update"
    );
  }

  console.log(
    `Set ${deploymentTargetReplacements} macOS deployment target entries to macOS 11.0`
  );

  // -----------------------------------------------------------------------
  // Automatic code signing
  // -----------------------------------------------------------------------

  // Remove any existing DEVELOPMENT_TEAM values first so we cannot end up
  // with conflicting or duplicate team settings.
  project = project.replace(
    /^\s*DEVELOPMENT_TEAM = [^;]*;\n/gm,
    ""
  );

  let signingStyleReplacements = 0;

  project = project.replace(
    /^(\s*)CODE_SIGN_STYLE = (?:Automatic|Manual);$/gm,
    (_match, indent) => {
      signingStyleReplacements += 1;

      return (
        `${indent}CODE_SIGN_STYLE = Automatic;\n` +
        `${indent}DEVELOPMENT_TEAM = ${teamID};`
      );
    }
  );

  if (signingStyleReplacements === 0) {
    throw new Error(
      "Could not find CODE_SIGN_STYLE settings in generated Xcode project"
    );
  }

  console.log(
    `Configured automatic signing for Apple team ${teamID} ` +
    `in ${signingStyleReplacements} build configurations`
  );

  // -----------------------------------------------------------------------
  // Final safety checks
  // -----------------------------------------------------------------------

  if (!project.includes(`DEVELOPMENT_TEAM = ${teamID};`)) {
    throw new Error(
      `Apple Developer team ${teamID} was not written to the Xcode project`
    );
  }

  if (!project.includes("MACOSX_DEPLOYMENT_TARGET = 11.0;")) {
    throw new Error(
      "macOS 11 deployment target was not written to the Xcode project"
    );
  }

  if (!project.includes("CODE_SIGN_STYLE = Automatic;")) {
    throw new Error(
      "Automatic code signing was not written to the Xcode project"
    );
  }

  await writeFile(projectPath, project);
' \
  "$xcode_project" \
  "$apple_team_id"

echo "Configured Xcode project:"
echo "  Apple team:        $apple_team_id"
echo "  Signing:           Automatic"
echo "  macOS minimum:     11.0"
echo "  macOS networking:  Enabled"

# ---------------------------------------------------------------------------
# Verify generated project
# ---------------------------------------------------------------------------

echo
echo "Signing configuration:"
grep -E \
  'DEVELOPMENT_TEAM|CODE_SIGN_STYLE|MACOSX_DEPLOYMENT_TARGET' \
  "$xcode_project" \
  | sort -u

echo

# ---------------------------------------------------------------------------
# Build release archive
# ---------------------------------------------------------------------------

version="$(
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { join } from "node:path";

    const root = process.argv[1];

    process.stdout.write(
      JSON.parse(
        readFileSync(
          join(root, "package.json"),
          "utf8"
        )
      ).version
    );
  ' "$root_dir"
)"

release_dir="$root_dir/release"
archive_path="$release_dir/novel-tracker-safari-xcode-$version.zip"

mkdir -p "$release_dir"
rm -f "$archive_path"

ditto \
  -c \
  -k \
  --norsrc \
  --keepParent \
  "$generated_app_dir" \
  "$archive_path"

echo
echo "Packaged Safari Xcode project:"
echo "  $archive_path"

echo
echo "The generated project uses:"
echo "  Team:                 $apple_team_id"
echo "  Signing style:        Automatic"
echo "  macOS deployment:     11.0"
echo "  App Store category:   Productivity"

echo
echo "The generated project is staged temporarily,"
echo "so existing local Xcode signing settings are not overwritten."

