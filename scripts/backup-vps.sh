#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${NOVEL_ENV_FILE:-/etc/novel-tracker/app.env}"
BACKUP_DIR="${NOVEL_BACKUP_DIR:-/var/backups/novel-tracker}"
RETENTION_DAYS="${NOVEL_BACKUP_RETENTION_DAYS:-14}"
OFFSITE_REMOTE="${NOVEL_BACKUP_RCLONE_REMOTE:-}"
REQUIRE_OFFSITE="${NOVEL_BACKUP_REQUIRE_OFFSITE:-1}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/novel-tracker-${STAMP}.dump"
TEMP_FILE="$(mktemp)"
CHECKSUM_FILE="$(mktemp)"
trap 'rm -f "${TEMP_FILE}" "${CHECKSUM_FILE}"' EXIT

[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || { echo "Backup retention must be a positive number of days." >&2; exit 1; }
[[ "$REQUIRE_OFFSITE" =~ ^[01]$ ]] || { echo "NOVEL_BACKUP_REQUIRE_OFFSITE must be 0 or 1." >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || { echo "Run this root-owned backup service as root." >&2; exit 1; }

docker compose --project-name novel-tracker --env-file "${ENV_FILE}" -f "${ROOT_DIR}/compose.yml" -f "${ROOT_DIR}/compose.production.yml" \
  exec -T postgres pg_dump --format=custom --no-owner --username=novel_tracker novel_tracker >"${TEMP_FILE}"
install -d -m 0700 "${BACKUP_DIR}"
install -m 0600 "${TEMP_FILE}" "${TARGET}"
sha256sum "${TEMP_FILE}" | awk '{print $1}' >"${CHECKSUM_FILE}"
install -m 0600 "${CHECKSUM_FILE}" "${TARGET}.sha256"

if [[ -n "$OFFSITE_REMOTE" ]]; then
  command -v rclone >/dev/null || { echo "rclone is required for offsite backups." >&2; exit 1; }
  rclone copyto "${TARGET}" "${OFFSITE_REMOTE%/}/$(basename "${TARGET}")"
  rclone copyto "${TARGET}.sha256" "${OFFSITE_REMOTE%/}/$(basename "${TARGET}.sha256")"
elif [[ "$REQUIRE_OFFSITE" == "1" ]]; then
  echo "NOVEL_BACKUP_RCLONE_REMOTE must point to an independently stored backup destination." >&2
  exit 1
fi

find "${BACKUP_DIR}" -type f -name 'novel-tracker-*.dump' -mtime "+${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -type f -name 'novel-tracker-*.dump.sha256' -mtime "+${RETENTION_DAYS}" -delete
echo "Created and checksummed ${TARGET}"
