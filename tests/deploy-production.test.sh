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
deploy_release() { trace deploy; }
wait_for_health() { trace health; }
configure_services() { trace configure; }
install_route() { trace route; }
verify_public() { trace public; return "$PUBLIC_RESULT"; }
show_status() { trace status; }
announce_success() { trace success; }
rollback_release() { trace rollback; }

main
diff -u <(printf '%s\n' validate lock prepare deploy health configure route public status success) "$TRACE_FILE"

: >"$TRACE_FILE"
PUBLIC_RESULT=1
if main; then
  echo "Expected public verification failure." >&2
  exit 1
fi
diff -u <(printf '%s\n' validate lock prepare deploy health configure route public rollback) "$TRACE_FILE"

echo "Remote deployment orchestration test passed."
