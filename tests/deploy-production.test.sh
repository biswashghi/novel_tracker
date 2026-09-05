#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/remote/deploy-production.sh
source "$ROOT_DIR/scripts/remote/deploy-production.sh"

TRACE_FILE="$(mktemp)"
PUBLIC_RESULT=0
trap 'rm -f "$TRACE_FILE"' EXIT
trace() { printf '%s\n' "$1" >>"$TRACE_FILE"; }
validate_inputs() { trace validate; }
acquire_lock() { trace lock; }
prepare_release() { trace prepare; }
create_recovery_point() { trace recovery; }
deploy_release() { trace deploy; }
wait_for_health() { trace health; }
configure_services() { trace configure; }
install_route() { trace route; }
verify_public() { trace public; return "$PUBLIC_RESULT"; }
show_status() { trace status; }
announce_success() { trace success; }
rollback_release() { trace rollback; }

main
diff -u <(printf '%s\n' validate lock prepare recovery deploy health configure route public status success) "$TRACE_FILE"

: >"$TRACE_FILE"
PUBLIC_RESULT=1
if main; then
  echo "Expected public verification failure." >&2
  exit 1
fi
diff -u <(printf '%s\n' validate lock prepare recovery deploy health configure route public rollback) "$TRACE_FILE"

# Apple provider bootstrap is part of the immutable API image and the remote
# deployment installs, runs, and schedules it. These assertions keep a future
# deployment refactor from silently dropping one side of that contract.
grep -Fq 'scripts/rotate-apple-secret.mjs ./scripts/rotate-apple-secret.mjs' "$ROOT_DIR/server/Dockerfile"
grep -Fq 'apk upgrade --no-cache' "$ROOT_DIR/server/Dockerfile"
grep -Fq 'rm -rf /root/.npm /usr/local/lib/node_modules/npm' "$ROOT_DIR/server/Dockerfile"
grep -Fq '!scripts/rotate-apple-secret.mjs' "$ROOT_DIR/.dockerignore"
grep -Fq 'novel-tracker-apple-secret.service' "$ROOT_DIR/scripts/deploy-vps.sh"
grep -Fq 'systemctl start novel-tracker-apple-secret.service' "$ROOT_DIR/scripts/remote/deploy-production.sh"
grep -Fq 'systemctl enable --now novel-tracker-apple-secret.timer' "$ROOT_DIR/scripts/remote/deploy-production.sh"
grep -Fq 'systemctl start novel-tracker-backup-verify.service' "$ROOT_DIR/scripts/remote/deploy-production.sh"
grep -Fq 'systemctl enable --now novel-tracker-backup-verify.timer' "$ROOT_DIR/scripts/remote/deploy-production.sh"
grep -Fq 'compose --project-name novel-tracker' "$ROOT_DIR/infra/novel-tracker-apple-secret.service"
grep -Fq 'https://meciopmpdehijfmbgbagndgknlmbmjoa.chromiumapp.org/oauth2' "$ROOT_DIR/scripts/configure-keycloak.sh"

echo "Remote deployment orchestration test passed."
