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

# The Chrome Web Store extension ID is public and stable. Realm imports only
# initialize new databases; an existing production realm does not pick up a
# later redirectUris change from infra/keycloak-realm.json. Repair the exact
# callback on every deployment so chrome.identity.launchWebAuthFlow can finish.
CHROME_REDIRECT=https://meciopmpdehijfmbgbagndgknlmbmjoa.chromiumapp.org/oauth2
CHROME_REDIRECT_EXISTS=$("$KCADM" get "clients/$CLIENT_UUID" -r "$REALM" --fields redirectUris --format csv --noquotes | grep -F "$CHROME_REDIRECT" || true)
if [ -z "$CHROME_REDIRECT_EXISTS" ]; then
  "$KCADM" update "clients/$CLIENT_UUID" -r "$REALM" -s 'redirectUris+="https://meciopmpdehijfmbgbagndgknlmbmjoa.chromiumapp.org/oauth2"'
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

# Which identity provider minted a token has to reach both the extension and the
# API: the UI tells readers which library they are looking at, and account
# deletion uses it to decide whether an Apple grant must also be revoked.
# Keycloak tracks it as the `identity_provider` session note; this mapper
# copies it into a `provider` claim on both token types.
PROVIDER_MAPPER=novel-tracker-identity-provider
printf %s '"'"'{"name":"novel-tracker-identity-provider","protocol":"openid-connect","protocolMapper":"oidc-usersessionmodel-note-mapper","consentRequired":false,"config":{"user.session.note":"identity_provider","claim.name":"provider","jsonType.label":"String","access.token.claim":"true","id.token.claim":"true"}}'"'"' >/tmp/novel-provider-mapper.json
PROVIDER_MAPPER_EXISTS=$("$KCADM" get "clients/$CLIENT_UUID/protocol-mappers/models" -r "$REALM" --fields name --format csv --noquotes | grep -Fx "$PROVIDER_MAPPER" || true)
if [ -z "$PROVIDER_MAPPER_EXISTS" ]; then
  "$KCADM" create "clients/$CLIENT_UUID/protocol-mappers/models" -r "$REALM" -f /tmp/novel-provider-mapper.json >/dev/null
fi
rm -f /tmp/novel-provider-mapper.json

# Google and Apple stay separate accounts even when they carry the same email
# address, so the realm has to tolerate duplicate emails. Keycloak only permits
# that when email login is off, and the order matters — it rejects
# duplicateEmailsAllowed while loginWithEmailAllowed is still true. Turning off
# email login costs nothing here: readers only ever authenticate through an
# identity provider, never against a Keycloak username/password form.
#
# Without this, a reader whose Apple email matches their Google one hits
# Keycloak'"'"'s "account already exists" screen, which dead-ends inside the
# extension popup.
"$KCADM" update "realms/$REALM" -s '"'"'loginWithEmailAllowed=false'"'"'
"$KCADM" update "realms/$REALM" -s '"'"'duplicateEmailsAllowed=true'"'"'

echo "Keycloak client redirects, audience mapping, provider claim, and realm login policy are configured."
echo "Run scripts/rotate-apple-secret.mjs to create or refresh the Apple identity provider."
'
