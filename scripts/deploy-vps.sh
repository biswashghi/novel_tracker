#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: NOVEL_API_DOMAIN=... NOVEL_AUTH_DOMAIN=... NOVEL_API_IMAGE=... $0 <deploy-user> <server-ip> [repo-url] [branch]"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then usage; exit 0; fi
if [[ $# -lt 2 || $# -gt 4 ]]; then usage >&2; exit 1; fi

DEPLOY_USER="$1"
SERVER_IP="$2"
API_DOMAIN="${NOVEL_API_DOMAIN:-${APP_API_DOMAIN:-}}"
AUTH_DOMAIN="${NOVEL_AUTH_DOMAIN:-${AUTH_HOST:-}}"
API_IMAGE="${NOVEL_API_IMAGE:-}"
RELEASE_SHA="${NOVEL_RELEASE_SHA:-}"
VERIFY_PUBLIC_DEPLOYMENT="${VERIFY_PUBLIC_DEPLOYMENT:-1}"

for domain in "$API_DOMAIN" "$AUTH_DOMAIN"; do
  [[ "$domain" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "Novel Tracker domains must be valid DNS names." >&2; exit 1; }
done
[[ "$API_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || { echo "NOVEL_API_IMAGE must be an immutable GHCR digest." >&2; exit 1; }
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "NOVEL_RELEASE_SHA must be a full Git commit SHA." >&2; exit 1; }
[[ "$VERIFY_PUBLIC_DEPLOYMENT" =~ ^[01]$ ]] || { echo "VERIFY_PUBLIC_DEPLOYMENT must be 0 or 1." >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PAYLOAD_FILE="$(mktemp)"
trap 'rm -f "$PAYLOAD_FILE"' EXIT
chmod 0600 "$PAYLOAD_FILE"
printf '%s\n' "NOVEL_API_IMAGE=${API_IMAGE}" >"$PAYLOAD_FILE"
printf '%s\n' "NOVEL_RELEASE_SHA=${RELEASE_SHA}" >>"$PAYLOAD_FILE"

scp -q "$ROOT_DIR/compose.yml" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-compose.yml"
scp -q "$ROOT_DIR/compose.production.yml" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-compose.production.yml"
scp -q "$ROOT_DIR/infra/keycloak-realm.json" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-keycloak-realm.json"
scp -q "$ROOT_DIR/infra/novel-tracker-backup.service" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-tracker-backup.service"
scp -q "$ROOT_DIR/infra/novel-tracker-backup.timer" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-tracker-backup.timer"
scp -q "$ROOT_DIR/infra/novel-tracker-backup-verify.service" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-tracker-backup-verify.service"
scp -q "$ROOT_DIR/infra/novel-tracker-backup-verify.timer" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-tracker-backup-verify.timer"
scp -q "$ROOT_DIR/infra/novel-tracker-apple-secret.service" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-tracker-apple-secret.service"
scp -q "$ROOT_DIR/infra/novel-tracker-apple-secret.timer" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-tracker-apple-secret.timer"
scp -q "$ROOT_DIR/scripts/configure-keycloak.sh" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-configure-keycloak.sh"
scp -q "$ROOT_DIR/scripts/backup-vps.sh" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-backup-vps.sh"
scp -q "$ROOT_DIR/scripts/verify-backup.sh" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-verify-backup.sh"
scp -q "$ROOT_DIR/deploy/novel-tracker.caddy.template" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-tracker.caddy.template"
scp -q "$ROOT_DIR/scripts/remote/deploy-production.sh" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-deploy-production.sh"
scp -q "$PAYLOAD_FILE" "${DEPLOY_USER}@${SERVER_IP}:/tmp/novel-release.env"

ssh "${DEPLOY_USER}@${SERVER_IP}" \
  API_DOMAIN="$API_DOMAIN" AUTH_DOMAIN="$AUTH_DOMAIN" \
  VERIFY_PUBLIC_DEPLOYMENT="$VERIFY_PUBLIC_DEPLOYMENT" \
  'bash /tmp/novel-deploy-production.sh'
