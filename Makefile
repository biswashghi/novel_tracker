SHELL := /bin/bash

POSTGRES_PASSWORD ?= novel-tracker-local-password
KEYCLOAK_ADMIN ?= admin
KEYCLOAK_ADMIN_PASSWORD ?= novel-tracker-local-admin-password
AUTH_URL ?= http://localhost:8793
KEYCLOAK_ISSUER ?= http://localhost:8793/realms/novel-tracker
KEYCLOAK_JWKS_URL ?= http://keycloak:8080/realms/novel-tracker/protocol/openid-connect/certs
# Account deletion removes the Keycloak user, so the API needs a service-account
# client with manage-users. Seeded by infra/keycloak-realm.e2e.json; the admin
# URL is container-internal for the same reason the JWKS URL is.
KEYCLOAK_ADMIN_URL ?= http://keycloak:8080
KEYCLOAK_ADMIN_CLIENT_ID ?= novel-tracker-admin
KEYCLOAK_ADMIN_CLIENT_SECRET ?= novel-tracker-e2e-admin-client-secret
export POSTGRES_PASSWORD KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD AUTH_URL KEYCLOAK_ISSUER KEYCLOAK_JWKS_URL KEYCLOAK_ADMIN_URL KEYCLOAK_ADMIN_CLIENT_ID KEYCLOAK_ADMIN_CLIENT_SECRET

NOVEL_ENV = env POSTGRES_PASSWORD="$(POSTGRES_PASSWORD)" KEYCLOAK_ADMIN="$(KEYCLOAK_ADMIN)" KEYCLOAK_ADMIN_PASSWORD="$(KEYCLOAK_ADMIN_PASSWORD)" AUTH_URL="$(AUTH_URL)" KEYCLOAK_ISSUER="$(KEYCLOAK_ISSUER)" KEYCLOAK_JWKS_URL="$(KEYCLOAK_JWKS_URL)" KEYCLOAK_ADMIN_URL="$(KEYCLOAK_ADMIN_URL)" KEYCLOAK_ADMIN_CLIENT_ID="$(KEYCLOAK_ADMIN_CLIENT_ID)" KEYCLOAK_ADMIN_CLIENT_SECRET="$(KEYCLOAK_ADMIN_CLIENT_SECRET)"
LOCAL_COMPOSE = $(NOVEL_ENV) docker compose -p novel-tracker-local -f compose.yml -f compose.local.yml
STAGING_PROJECT ?= novel-tracker-staging
STAGING_COMPOSE = $(NOVEL_ENV) docker compose -p $(STAGING_PROJECT) -f compose.yml -f compose.staging.yml
PRODUCTION_COMPOSE = $(NOVEL_ENV) docker compose -p novel-tracker -f compose.yml -f compose.production.yml

.PHONY: local-up local-test local-down local-reset docker-build staging-test package-test production-validate deployment-test

local-up:
	$(LOCAL_COMPOSE) up -d --build --wait

local-test:
	npm ci
	npm run test
	$(LOCAL_COMPOSE) up -d --build --wait
	npm run build:e2e
	npm run test:e2e

local-down:
	$(LOCAL_COMPOSE) down

local-reset:
	$(LOCAL_COMPOSE) down --volumes --remove-orphans

docker-build:
	$(STAGING_COMPOSE) build api

staging-test:
	@set -uo pipefail; rm -f staging.log; \
	  cleanup() { $(STAGING_COMPOSE) down --volumes --remove-orphans; }; \
	  trap cleanup EXIT; \
	  status=0; \
	  build_flag=--build; \
	  if [[ -n "$${STAGING_NO_BUILD:-}" ]]; then build_flag=--no-build; fi; \
	  $(STAGING_COMPOSE) up -d $$build_flag --wait || status=$$?; \
	  if [[ $$status -eq 0 ]]; then curl --fail --silent --show-error http://127.0.0.1:$${NOVEL_API_STAGING_PORT:-8792}/ready >/dev/null || status=$$?; fi; \
	  if [[ $$status -eq 0 ]]; then curl --fail --silent --show-error --retry 60 --retry-delay 2 --retry-all-errors http://127.0.0.1:$${NOVEL_AUTH_STAGING_PORT:-8793}/realms/novel-tracker/.well-known/openid-configuration >/dev/null || status=$$?; fi; \
	  if [[ $$status -eq 0 ]]; then npm run test:integration || status=$$?; fi; \
	  if [[ $$status -eq 0 ]]; then npm run build:e2e || status=$$?; fi; \
	  if [[ $$status -eq 0 ]]; then npm run test:e2e || status=$$?; fi; \
	  if [[ $$status -ne 0 ]]; then $(STAGING_COMPOSE) logs --no-color > staging.log 2>&1 || true; fi; \
	  exit $$status

package-test:
	@set -euo pipefail; \
	  package="$(PACKAGE)"; \
	  if [[ -z "$$package" ]]; then \
	    version="$$(node -p "require('./package.json').version")"; \
	    package="release/novel-tracker-extension-$$version.zip"; \
	  fi; \
	  test -f "$$package"; \
	  unpacked="$$(mktemp -d "$${TMPDIR:-/tmp}/novel-tracker-package.XXXXXX")"; \
	  cleanup() { rm -rf -- "$$unpacked"; }; \
	  trap cleanup EXIT; \
	  unzip -q "$$package" -d "$$unpacked"; \
	  chmod -R a+rX "$$unpacked"; \
	  NOVEL_EXTENSION_DIR="$$unpacked" npm run test:e2e:package

production-validate:
	$(PRODUCTION_COMPOSE) config --quiet
	$(MAKE) deployment-test

deployment-test:
	bash tests/deploy-production.test.sh
