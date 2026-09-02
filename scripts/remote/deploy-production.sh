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
  [[ "$API_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]
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
  sudo install -m 0755 /tmp/novel-deploy-production.sh "$APP_DIR/scripts/deploy-production.sh"
  set_env NOVEL_API_IMAGE "$API_IMAGE"
  set_env AUTH_HOST "$AUTH_DOMAIN"
  set_env AUTH_URL "https://${AUTH_DOMAIN}"
  set_env KEYCLOAK_ISSUER "https://${AUTH_DOMAIN}/realms/novel-tracker"
  set_env KEYCLOAK_JWKS_URL ""
  sudo chmod 0600 "$ENV_FILE"
}

rollback_release() {
  [[ -n "$PREVIOUS_IMAGE" ]] || return 0
  echo "Rolling Novel Tracker back to ${PREVIOUS_IMAGE}." >&2
  set_env NOVEL_API_IMAGE "$PREVIOUS_IMAGE"
  compose pull api || true
  compose up -d --no-build || true
}

deploy_release() {
  compose pull api keycloak postgres
  compose up -d --no-build
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 60); do
    if sudo docker exec shared-caddy wget -qO- \
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
  sudo install -m 0644 /tmp/novel-tracker-backup.service /etc/systemd/system/novel-tracker-backup.service
  sudo install -m 0644 /tmp/novel-tracker-backup.timer /etc/systemd/system/novel-tracker-backup.timer
  sudo systemctl daemon-reload
  sudo systemctl enable --now novel-tracker-backup.timer
}

install_route() {
  sed -e "s/{{NOVEL_API_DOMAIN}}/${API_DOMAIN}/g" \
    -e "s/{{NOVEL_AUTH_DOMAIN}}/${AUTH_DOMAIN}/g" "$ROUTE_TEMPLATE" | \
    sudo /usr/local/bin/vps-route novel-tracker
}

verify_public() {
  if [[ "$VERIFY_PUBLIC_DEPLOYMENT" == "1" ]]; then
    curl -fsS --retry 6 --retry-delay 5 "https://${API_DOMAIN}/health" >/dev/null &&
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
  if ! deploy_release; then rollback_release; return 1; fi
  if ! wait_for_health; then rollback_release; return 1; fi
  if ! configure_services; then rollback_release; return 1; fi
  if ! install_route; then rollback_release; return 1; fi
  if ! verify_public; then rollback_release; return 1; fi
  show_status
  announce_success
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  trap 'rm -f /tmp/novel-release.env /tmp/novel-tracker.caddy.template /tmp/novel-deploy-production.sh' EXIT
  main "$@"
fi
