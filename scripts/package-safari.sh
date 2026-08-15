#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
npm --prefix "$root_dir" run build:safari
exec xcrun safari-web-extension-converter "$root_dir/dist-safari" \
  --app-name "Novel Tracker" \
  --bundle-identifier "app.noveltracker.extension" \
  --project-location "$root_dir/safari-app" \
  --no-prompt
