#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${NOVEL_ENV_FILE:-/etc/novel-tracker/app.env}"
COMPOSE=(sudo docker compose --project-name novel-tracker --env-file "${ENV_FILE}" -f "${ROOT_DIR}/compose.yml" -f "${ROOT_DIR}/compose.production.yml")

"${COMPOSE[@]}" exec -T keycloak sh -ec '
KCADM=/opt/keycloak/bin/kcadm.sh
REALM=novel-tracker
CLIENT=novel-tracker-extension
MAPPER=novel-tracker-api-audience

"$KCADM" config credentials \
  --server http://127.0.0.1:8080 \
  --realm master \
  --user "$KEYCLOAK_ADMIN" \
  --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

CLIENT_UUID=$("$KCADM" get clients -r "$REALM" -q clientId="$CLIENT" --fields id --format csv --noquotes | head -n 1)
if [ -z "$CLIENT_UUID" ]; then
  echo "Could not find Keycloak client $CLIENT" >&2
  exit 1
fi

FIREFOX_REDIRECT=http://127.0.0.1/mozoauth2/*
REDIRECT_EXISTS=$("$KCADM" get "clients/$CLIENT_UUID" -r "$REALM" --fields redirectUris --format csv --noquotes | grep -F "$FIREFOX_REDIRECT" || true)
if [ -z "$REDIRECT_EXISTS" ]; then
  "$KCADM" update "clients/$CLIENT_UUID" -r "$REALM" -s 'redirectUris+="http://127.0.0.1/mozoauth2/*"'
fi

SAFARI_REDIRECT=noveltracker://oauth/callback
SAFARI_REDIRECT_EXISTS=$("$KCADM" get "clients/$CLIENT_UUID" -r "$REALM" --fields redirectUris --format csv --noquotes | grep -F "$SAFARI_REDIRECT" || true)
if [ -z "$SAFARI_REDIRECT_EXISTS" ]; then
  "$KCADM" update "clients/$CLIENT_UUID" -r "$REALM" -s 'redirectUris+="noveltracker://oauth/callback"'
fi

printf %s '"'"'{"attributes":{"pkce.code.challenge.method":"S256"}}'"'"' >/tmp/novel-client-pkce.json
"$KCADM" update "clients/$CLIENT_UUID" -r "$REALM" -f /tmp/novel-client-pkce.json
rm -f /tmp/novel-client-pkce.json

printf %s '"'"'{"name":"novel-tracker-api-audience","protocol":"openid-connect","protocolMapper":"oidc-audience-mapper","consentRequired":false,"config":{"included.client.audience":"novel-tracker-api","access.token.claim":"true","id.token.claim":"false"}}'"'"' >/tmp/novel-audience-mapper.json
MAPPER_EXISTS=$("$KCADM" get "clients/$CLIENT_UUID/protocol-mappers/models" -r "$REALM" --fields name --format csv --noquotes | grep -Fx "$MAPPER" || true)
if [ -z "$MAPPER_EXISTS" ]; then
  "$KCADM" create "clients/$CLIENT_UUID/protocol-mappers/models" -r "$REALM" -f /tmp/novel-audience-mapper.json >/dev/null
fi
rm -f /tmp/novel-audience-mapper.json

echo "Keycloak client audience mapping is configured."
'
