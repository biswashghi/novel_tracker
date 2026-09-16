#!/usr/bin/env bash
set -euo pipefail

# Keycloak 26.1.5 uses the Apple provider release compatible with 25.0.0 < KC < 26.2.3.
# Pin both the release URL and the independently recorded SHA-512 digest; a
# mutable GitHub release asset cannot silently change the code Keycloak loads.
VERSION=1.14.0
JAR="apple-identity-provider-${VERSION}.jar"
EXPECTED_SHA512=478afce951c5c6596cbb224b15d01b823b41f787a046a9e6b11d7aae103a766b7006f6f250c0ed2e44e104799254299068c891b41d8bb81c90086153810a3101
SOURCE="https://github.com/klausbetz/apple-identity-provider-keycloak/releases/download/${VERSION}/${JAR}"
DEST_DIR="${1:?Usage: install-keycloak-apple-provider.sh DEST_DIR}"
DEST="${DEST_DIR}/${JAR}"

digest() {
  if command -v sha512sum >/dev/null 2>&1; then
    sha512sum "$1" | awk '{print $1}'
  else
    shasum -a 512 "$1" | awk '{print $1}'
  fi
}

if [[ -e "$DEST" ]]; then
  [[ -f "$DEST" ]] || { echo "Apple provider target is not a regular file: $DEST" >&2; exit 1; }
  [[ "$(digest "$DEST")" == "$EXPECTED_SHA512" ]] || {
    echo "Existing Apple provider JAR failed the pinned SHA-512 check: $DEST" >&2
    exit 1
  }
  echo "Apple provider ${VERSION} already verified at ${DEST}."
  exit 0
fi

install -d -m 0755 "$DEST_DIR"
TEMP="$(mktemp "${DEST_DIR}/.${JAR}.XXXXXX")"
trap 'rm -f -- "$TEMP"' EXIT
curl --fail --location --silent --show-error --retry 3 --proto '=https' --tlsv1.2 "$SOURCE" --output "$TEMP"
[[ "$(digest "$TEMP")" == "$EXPECTED_SHA512" ]] || {
  echo "Downloaded Apple provider JAR failed the pinned SHA-512 check." >&2
  exit 1
}
chmod 0644 "$TEMP"
mv -n -- "$TEMP" "$DEST"
[[ "$(digest "$DEST")" == "$EXPECTED_SHA512" ]] || {
  echo "Apple provider JAR changed during installation: $DEST" >&2
  exit 1
}
echo "Installed verified Apple provider ${VERSION} at ${DEST}."
