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
  "rejectedMutations": [
    { "index": 0, "mutationId": "uuid", "reason": "invalid-mutation" }
  ],
  "novelIdMappings": [
    { "localNovelId": "uuid", "canonicalNovelId": "uuid" }
  ],
  "state": { "version": 1, "novels": {} },
  "mutations": [],
  "cursor": "opaque-cursor"
}
```

### Limits

At most 500 mutations per batch (`413` beyond that) and 8 KB of JSON per
mutation. The body limit is derived from the two so a worst-case *legal* batch
can never be refused by an opaque body-size error before per-item validation
runs.

### Rejections

A structurally invalid or oversized mutation is reported in
`rejectedMutations`, never silently skipped. This matters because a client
drops a pending mutation only when it hears back about it: a silently skipped
mutation would sit in the pending queue and be re-sent on every future sync,
wedging that account permanently.

`index` is the mutation's position in the submitted array and is the field
clients should match on — the one mutation an id cannot identify is the one
rejected for having no usable id. Current reasons are `invalid-mutation` and
`payload-too-large`.

### `state` and `appliedMutations`

`state` is the full canonical blob and is **omitted** when a batch applied no
changes (a duplicate replay or an all-rejected batch), so steady-state polling
stays small. Clients must still adopt `novelIdMappings` from a response that
carries no `state`.

The blob never contains `appliedMutations`. `sync_mutation_receipts` is the
server's durable dedup record, so keeping the map in the JSONB state only made
`sync_states` grow without bound and get rewritten on every batch. Clients keep
their own bounded replay map (`MAX_APPLIED_MUTATIONS`) and must restore it when
adopting a canonical blob.

Replaying an already-applied mutation is safe without that map: checkpoint
events dedupe by event id, field patches lose LWW to newer clocks, and
delete/restore are generation-guarded. Chapter history is deliberately *not*
capped — the event-id map is what makes replay idempotent, so capping it would
need a replicated per-novel history floor first.

## `GET /v1/sync?cursor=opaque-cursor`

Returns up to 1,000 mutations visible after the cursor plus the next cursor and
`hasMore`. A missing
cursor performs the initial account pull. The server returns tombstones as
ordinary `novel.delete` mutations so clients suppress stale updates.

## Lifecycle rules

The API must retain accepted mutations for idempotency, retain delete
tombstones for 30 days, and reject non-restore mutations targeting a deleted
or prior generation. The server must use the same `sync-core` merge rules as
the extension; it must not replace a complete novel document.

## Identity-provider setup

After the Keycloak container is available at the configured auth domain, add
Google under **Identity providers** in the `novel-tracker` realm.
Keep their client secrets in Keycloak's database/admin UI rather than in this
repository or the Docker Compose environment.

The extension uses Authorization Code with PKCE. `novel-tracker-extension`
must have an audience mapper that adds `novel-tracker-api` to access tokens.
`scripts/configure-keycloak.sh` makes that mapper idempotently on deployment.
