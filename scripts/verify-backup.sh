#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${NOVEL_BACKUP_DIR:-/var/backups/novel-tracker}"
POSTGRES_IMAGE="${NOVEL_BACKUP_POSTGRES_IMAGE:-postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73}"
BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  shopt -s nullglob
  for candidate in "$BACKUP_DIR"/novel-tracker-*.dump; do
    if [[ -z "$BACKUP_FILE" || "$candidate" -nt "$BACKUP_FILE" ]]; then
      BACKUP_FILE="$candidate"
    fi
  done
fi
[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || { echo "No database backup is available to verify." >&2; exit 1; }
[[ -f "${BACKUP_FILE}.sha256" ]] || { echo "Missing checksum for ${BACKUP_FILE}." >&2; exit 1; }

expected_checksum="$(tr -d '[:space:]' <"${BACKUP_FILE}.sha256")"
actual_checksum="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
[[ "$actual_checksum" == "$expected_checksum" ]] || { echo "Backup checksum mismatch for ${BACKUP_FILE}." >&2; exit 1; }

container_name="novel-tracker-restore-verify-$$"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$container_name" -e POSTGRES_PASSWORD=restore-verification-only "$POSTGRES_IMAGE" >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  [[ "$attempt" -lt 30 ]] || { echo "Restore-verification database did not become ready." >&2; exit 1; }
  sleep 1
done

docker cp "$BACKUP_FILE" "$container_name:/tmp/backup.dump"
docker exec "$container_name" createdb -U postgres novel_tracker_restore
docker exec "$container_name" pg_restore --exit-on-error --no-owner -U postgres -d novel_tracker_restore /tmp/backup.dump

tables_ok="$(docker exec "$container_name" psql -U postgres -d novel_tracker_restore -Atqc \
  "SELECT count(*) = 5 FROM pg_class WHERE relkind = 'r' AND relname IN ('sync_states','sync_mutations','novel_id_mappings','sync_mutation_receipts','purged_novel_ids')")"
[[ "$tables_ok" == "t" ]] || { echo "Restored backup is missing one or more application tables." >&2; exit 1; }

echo "Verified that ${BACKUP_FILE} restores successfully in an isolated PostgreSQL instance."
