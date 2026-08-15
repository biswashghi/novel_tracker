#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${NOVEL_BACKUP_DIR:-/var/backups/novel-tracker}"
RETENTION_DAYS="${NOVEL_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/novel-tracker-${STAMP}.dump"
TEMP_FILE="$(mktemp)"
trap 'rm -f "${TEMP_FILE}"' EXIT

sudo docker compose --env-file "${ROOT_DIR}/.env.prod" -f "${ROOT_DIR}/infra/docker-compose.yml" \
  exec -T postgres pg_dump --format=custom --no-owner --username=novel_tracker novel_tracker >"${TEMP_FILE}"
sudo install -d -m 0700 "${BACKUP_DIR}"
sudo install -m 0600 "${TEMP_FILE}" "${TARGET}"
sudo find "${BACKUP_DIR}" -type f -name 'novel-tracker-*.dump' -mtime "+${RETENTION_DAYS}" -delete
echo "Created ${TARGET}"
