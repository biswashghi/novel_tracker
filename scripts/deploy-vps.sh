#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo "Usage: $0 <deploy-user> <server-ip> <repo-url> [branch]" >&2
  exit 1
fi

DEPLOY_USER="$1"
SERVER_IP="$2"
REPO_URL="$3"
BRANCH="${4:-main}"
APP_DIR="/opt/novel-tracker"
SERVER_ENV_FILE="/etc/novel-tracker/app.env"
API_PORT="${NOVEL_API_HOST_PORT:-8792}"
AUTH_PORT="${NOVEL_AUTH_HOST_PORT:-8793}"

ssh "${DEPLOY_USER}@${SERVER_IP}" <<EOF
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl git
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \$VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker ${DEPLOY_USER}
fi

if ! sudo test -f "${SERVER_ENV_FILE}"; then
  echo "Missing ${SERVER_ENV_FILE}. Create it on the VPS with POSTGRES_PASSWORD, KEYCLOAK_ADMIN, KEYCLOAK_ADMIN_PASSWORD, and AUTH_HOST." >&2
  exit 1
fi

if [[ ! -d "${APP_DIR}/.git" ]]; then
  sudo mkdir -p "${APP_DIR}"
  sudo chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
else
  cd "${APP_DIR}"
  git fetch origin
  git checkout "${BRANCH}"
  git pull --ff-only origin "${BRANCH}"
fi

sudo cp "${SERVER_ENV_FILE}" "${APP_DIR}/.env.prod"
sudo chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/.env.prod"
cd "${APP_DIR}"
sudo NOVEL_API_HOST_PORT="${API_PORT}" NOVEL_AUTH_HOST_PORT="${AUTH_PORT}" docker compose --env-file .env.prod -f infra/docker-compose.yml up -d --build
for attempt in \$(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:${AUTH_PORT}/realms/novel-tracker/.well-known/openid-configuration" >/dev/null; then
    break
  fi
  if [[ "\${attempt}" -eq 60 ]]; then
    echo "Keycloak did not become ready in time." >&2
    exit 1
  fi
  sleep 2
done
./scripts/configure-keycloak.sh
sudo install -m 0644 infra/novel-tracker-backup.service /etc/systemd/system/novel-tracker-backup.service
sudo install -m 0644 infra/novel-tracker-backup.timer /etc/systemd/system/novel-tracker-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now novel-tracker-backup.timer
sudo docker compose --env-file .env.prod -f infra/docker-compose.yml ps
curl --fail --silent "http://127.0.0.1:${API_PORT}/health" >/dev/null
curl --fail --silent "https://api.novel.bghimire.com/health" >/dev/null
curl --fail --silent "https://auth.novel.bghimire.com/realms/novel-tracker/.well-known/openid-configuration" >/dev/null
echo "Novel Tracker API, authentication, and backup timer are ready."
EOF
