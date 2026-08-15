# Sync API Contract

All endpoints require a Keycloak access token for the `novel-tracker-api`
audience. Requests and responses are JSON.

## `POST /v1/sync/mutations`

Accepts `{ "mutations": NovelMutation[] }`. The server deduplicates each
mutation by `(subject, mutationId)`, applies the remove-wins/HLC rules, and
returns:

```json
{
  "acknowledgedMutationIds": ["uuid"],
  "mutations": [],
  "cursor": "opaque-cursor"
}
```

## `GET /v1/sync?cursor=opaque-cursor`

Returns mutations visible after the cursor plus the next cursor. A missing
cursor performs the initial account pull. The server returns tombstones as
ordinary `novel.delete` mutations so clients suppress stale updates.

## Lifecycle rules

The API must retain accepted mutations for idempotency, retain delete
tombstones for 30 days, and reject non-restore mutations targeting a deleted
or prior generation. The server must use the same `sync-core` merge rules as
the extension; it must not replace a complete novel document.

## Identity-provider setup

After the Keycloak container is available at the configured auth domain, add
Google and Apple under **Identity providers** in the `novel-tracker` realm.
Keep their client secrets in Keycloak's database/admin UI rather than in this
repository or the Docker Compose environment.
