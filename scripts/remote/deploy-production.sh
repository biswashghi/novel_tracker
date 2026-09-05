#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/novel-tracker}"
ENV_FILE="${ENV_FILE:-/etc/novel-tracker/app.env}"
RELEASE_FILE="${RELEASE_FILE:-/tmp/novel-release.env}"
ROUTE_TEMPLATE="${ROUTE_TEMPLATE:-/tmp/novel-tracker.caddy.template}"
API_DOMAIN="${API_DOMAIN:-}"
AUTH_DOMAIN="${AUTH_DOMAIN:-}"
VERIFY_PUBLIC_DEPLOYMENT="${VERIFY_PUBLIC_DEPLOYMENT:-1}"
API_IMAGE=""
RELEASE_SHA=""
PREVIOUS_IMAGE=""

compose() {
  sudo docker compose -p novel-tracker --env-file "$ENV_FILE" \
    -f "$APP_DIR/compose.yml" -f "$APP_DIR/compose.production.yml" "$@"
}

set_env() {
  local key="$1" value="$2"
  if sudo grep -q "^${key}=" "$ENV_FILE"; then
    sudo sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" | sudo tee -a "$ENV_FILE" >/dev/null
  fi
}

validate_inputs() {
  [[ "$API_DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]
  [[ "$AUTH_DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]
  [[ "$VERIFY_PUBLIC_DEPLOYMENT" =~ ^[01]$ ]]
  test -s "$RELEASE_FILE"
  test -s "$ROUTE_TEMPLATE"
  API_IMAGE="$(sed -n 's/^NOVEL_API_IMAGE=//p' "$RELEASE_FILE")"
  RELEASE_SHA="$(sed -n 's/^NOVEL_RELEASE_SHA=//p' "$RELEASE_FILE")"
  [[ "$API_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]
  [[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]
}

acquire_lock() {
  exec 9>/tmp/vps-deploy-novel-tracker.lock
  flock 9
  sudo /usr/local/bin/vps-platform-check
  sudo test -f "$ENV_FILE" || {
    echo "Missing ${ENV_FILE} with production database and Keycloak secrets." >&2
    return 1
  }
}

prepare_release() {
  PREVIOUS_IMAGE="$(sudo sed -n 's/^NOVEL_API_IMAGE=//p' "$ENV_FILE" 2>/dev/null || true)"

  # Stop the legacy implicit infra project without removing its volumes.
  if sudo docker ps -aq --filter label=com.docker.compose.project=infra | grep -q .; then
    sudo docker ps -aq --filter label=com.docker.compose.project=infra |
      while read -r container_id; do sudo docker rm -f "$container_id" >/dev/null; done
  fi

  sudo install -d -m 0755 "$APP_DIR" "$APP_DIR/infra" "$APP_DIR/scripts"
  sudo install -m 0644 /tmp/novel-compose.yml "$APP_DIR/compose.yml"
  sudo install -m 0644 /tmp/novel-compose.production.yml "$APP_DIR/compose.production.yml"
  sudo install -m 0644 /tmp/novel-keycloak-realm.json "$APP_DIR/infra/keycloak-realm.json"
  sudo install -m 0755 /tmp/novel-configure-keycloak.sh "$APP_DIR/scripts/configure-keycloak.sh"
  sudo install -m 0755 /tmp/novel-backup-vps.sh "$APP_DIR/scripts/backup-vps.sh"
  sudo install -m 0755 /tmp/novel-verify-backup.sh "$APP_DIR/scripts/verify-backup.sh"
  sudo install -m 0755 /tmp/novel-deploy-production.sh "$APP_DIR/scripts/deploy-production.sh"
  sudo install -m 0644 /tmp/novel-tracker-backup.service /etc/systemd/system/novel-tracker-backup.service
  sudo install -m 0644 /tmp/novel-tracker-backup.timer /etc/systemd/system/novel-tracker-backup.timer
  sudo install -m 0644 /tmp/novel-tracker-backup-verify.service /etc/systemd/system/novel-tracker-backup-verify.service
  sudo install -m 0644 /tmp/novel-tracker-backup-verify.timer /etc/systemd/system/novel-tracker-backup-verify.timer
  sudo systemctl daemon-reload
  set_env NOVEL_API_IMAGE "$API_IMAGE"
  set_env AUTH_HOST "$AUTH_DOMAIN"
  set_env AUTH_URL "https://${AUTH_DOMAIN}"
  set_env KEYCLOAK_ISSUER "https://${AUTH_DOMAIN}/realms/novel-tracker"
  set_env KEYCLOAK_JWKS_URL ""
  # Both the API and the one-shot Apple rotation container reach Keycloak over
  # the private Compose network. This also makes the very first deployment
  # independent of whether the public Caddy route has been installed yet.
  set_env KEYCLOAK_ADMIN_URL "http://keycloak:8080"
  sudo chmod 0600 "$ENV_FILE"
}

create_recovery_point() {
  if compose ps --status running --services | grep -qx postgres; then
    sudo systemctl start novel-tracker-backup.service
    sudo systemctl start novel-tracker-backup-verify.service
  else
    echo "No existing database is running; skipping the pre-deployment recovery point."
  fi
}

rollback_release() {
  [[ -n "$PREVIOUS_IMAGE" ]] || return 0
  echo "Rolling Novel Tracker back to ${PREVIOUS_IMAGE}." >&2
  set_env NOVEL_API_IMAGE "$PREVIOUS_IMAGE"
  compose pull api || true
  compose up -d --no-build || true
  local attempt
  for attempt in $(seq 1 30); do
    # The immediately previous production image can predate /ready. Its
    # liveness endpoint is the stable backward-compatible rollback contract.
    if sudo docker exec shared-caddy wget -qO- "http://novel-api:3000/health" </dev/null >/dev/null 2>&1; then
      echo "Rollback is ready on ${PREVIOUS_IMAGE}." >&2
      return 0
    fi
    sleep 2
  done
  echo "Rollback image failed readiness verification." >&2
  return 1
}

deploy_release() {
  compose pull api keycloak postgres
  compose up -d --no-build
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 60); do
    if sudo docker exec shared-caddy wget -qO- "http://novel-api:3000/ready" </dev/null >/dev/null &&
      sudo docker exec shared-caddy wget -qO- \
        "http://novel-auth:8080/realms/novel-tracker/.well-known/openid-configuration" </dev/null >/dev/null; then
      return 0
    fi
    if [[ "$attempt" -eq 60 ]]; then
      compose logs --tail=100 postgres keycloak api >&2 || true
      return 1
    fi
    sleep 2
  done
}

configure_services() {
  "$APP_DIR/scripts/configure-keycloak.sh"
  sudo install -m 0644 /tmp/novel-tracker-apple-secret.service /etc/systemd/system/novel-tracker-apple-secret.service
  sudo install -m 0644 /tmp/novel-tracker-apple-secret.timer /etc/systemd/system/novel-tracker-apple-secret.timer
  sudo systemctl daemon-reload
  sudo systemctl enable --now novel-tracker-backup.timer
  sudo systemctl enable --now novel-tracker-backup-verify.timer
  # The timer's first calendar event may be weeks away. Start the oneshot now
  # so a missing provider is created on the first deployment and an existing
  # provider receives a fresh client secret on every later deployment.
  sudo systemctl start novel-tracker-apple-secret.service
  sudo systemctl enable --now novel-tracker-apple-secret.timer
}

install_route() {
  sed -e "s/{{NOVEL_API_DOMAIN}}/${API_DOMAIN}/g" \
    -e "s/{{NOVEL_AUTH_DOMAIN}}/${AUTH_DOMAIN}/g" "$ROUTE_TEMPLATE" | \
    sudo /usr/local/bin/vps-route novel-tracker
}

verify_public() {
  if [[ "$VERIFY_PUBLIC_DEPLOYMENT" == "1" ]]; then
    readiness="$(curl -fsS --retry 6 --retry-delay 5 "https://${API_DOMAIN}/ready")" &&
      grep -Fq "\"commit\":\"${RELEASE_SHA}\"" <<<"$readiness" &&
      curl -fsS --retry 6 --retry-delay 5 \
        "https://${AUTH_DOMAIN}/realms/novel-tracker/.well-known/openid-configuration" >/dev/null
  fi
}

show_status() { compose ps; }
announce_success() { echo "Novel Tracker deployed from an immutable API image."; }

main() {
  validate_inputs
  acquire_lock
  prepare_release
  if ! create_recovery_point; then return 1; fi
  if ! deploy_release; then rollback_release; return 1; fi
  if ! wait_for_health; then rollback_release; return 1; fi
  if ! configure_services; then rollback_release; return 1; fi
  if ! install_route; then rollback_release; return 1; fi
  if ! verify_public; then rollback_release; return 1; fi
  show_status
  announce_success
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  trap 'rm -f /tmp/novel-release.env /tmp/novel-compose.yml /tmp/novel-compose.production.yml /tmp/novel-keycloak-realm.json /tmp/novel-configure-keycloak.sh /tmp/novel-backup-vps.sh /tmp/novel-verify-backup.sh /tmp/novel-deploy-production.sh /tmp/novel-tracker.caddy.template /tmp/novel-tracker-backup.service /tmp/novel-tracker-backup.timer /tmp/novel-tracker-backup-verify.service /tmp/novel-tracker-backup-verify.timer /tmp/novel-tracker-apple-secret.service /tmp/novel-tracker-apple-secret.timer' EXIT
  main "$@"
fi
