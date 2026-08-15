#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(sudo docker compose --env-file "${ROOT_DIR}/.env.prod" -f "${ROOT_DIR}/infra/docker-compose.yml")

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

printf %s '"'"'{"attributes":{"pkce.code.challenge.method":"S256"}}'"'"' >/tmp/novel-client-pkce.json
"$KCADM" update "clients/$CLIENT_UUID" -r "$REALM" -f /tmp/novel-client-pkce.json
rm -f /tmp/novel-client-pkce.json

printf %s '"'"'{"name":"novel-tracker-api-audience","protocol":"openid-connect","protocolMapper":"oidc-audience-mapper","consentRequired":false,"config":{"included.client.audience":"novel-tracker-api","access.token.claim":"true","id.token.claim":"false"}}'"'"' >/tmp/novel-audience-mapper.json
MAPPER_LINE=$("$KCADM" get "clients/$CLIENT_UUID/protocol-mappers/models" -r "$REALM" --fields id,name --format csv --noquotes | grep ",${MAPPER}$" || true)
if [ -z "$MAPPER_LINE" ]; then
  "$KCADM" create "clients/$CLIENT_UUID/protocol-mappers/models" -r "$REALM" -f /tmp/novel-audience-mapper.json >/dev/null
else
  MAPPER_UUID=${MAPPER_LINE%%,*}
  "$KCADM" update "clients/$CLIENT_UUID/protocol-mappers/models/$MAPPER_UUID" -r "$REALM" -f /tmp/novel-audience-mapper.json
fi
rm -f /tmp/novel-audience-mapper.json

echo "Keycloak client audience mapping is configured."
'
