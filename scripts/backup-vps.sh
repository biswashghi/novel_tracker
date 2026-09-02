#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${NOVEL_ENV_FILE:-/etc/novel-tracker/app.env}"
BACKUP_DIR="${NOVEL_BACKUP_DIR:-/var/backups/novel-tracker}"
RETENTION_DAYS="${NOVEL_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/novel-tracker-${STAMP}.dump"
TEMP_FILE="$(mktemp)"
trap 'rm -f "${TEMP_FILE}"' EXIT

sudo docker compose --project-name novel-tracker --env-file "${ENV_FILE}" -f "${ROOT_DIR}/compose.yml" -f "${ROOT_DIR}/compose.production.yml" \
  exec -T postgres pg_dump --format=custom --no-owner --username=novel_tracker novel_tracker >"${TEMP_FILE}"
sudo install -d -m 0700 "${BACKUP_DIR}"
sudo install -m 0600 "${TEMP_FILE}" "${TARGET}"
sudo find "${BACKUP_DIR}" -type f -name 'novel-tracker-*.dump' -mtime "+${RETENTION_DAYS}" -delete
echo "Created ${TARGET}"
