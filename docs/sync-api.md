# Sync API Contract

All endpoints require a Keycloak access token for the `novel-tracker-api`
audience. Requests and responses are JSON.

## Version and client identity

The major API version is part of every public route (`/v1/...`). A change is
compatible with v1 only when every already-published v1 client continues to
work without changing its request or response assumptions. Additive optional
fields and new routes are allowed; removing or renaming fields/routes, changing
their meaning, or making optional data required needs `/v2` while `/v1` stays
available.

New extension builds send these headers on every API request:

- `X-Novel-Tracker-API-Version: 1`
- `X-Novel-Tracker-Client-Version: <manifest/app version>`
- `X-Novel-Tracker-Client-Platform: chrome|firefox|safari|safari-ios-app`

The URL is authoritative. A conflicting API-version header is rejected with
`400`; the header may be absent for older installed clients. API responses carry
`X-Novel-Tracker-API-Version: 1`.

The server stores only the API version, client version, platform, first/last
seen timestamps, and aggregate request count in `api_client_usage`. It does not
store an account or device identifier there. This durable aggregate is the
retirement signal; ordinary container logs can rotate.

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

## `DELETE /v1/account/data`

Erases everything synced to the account — states, mutations, receipts, id
mappings, and purge records — while leaving the account itself intact. The next
sync repopulates the server from whatever the device still holds. This is what
the endpoint below used to do, and it is the reset the integration suite uses
between runs.

## `DELETE /v1/account`

Deletes the account itself. Required by App Store guideline 5.1.1(v), which
does not accept deactivating or disconnecting as a substitute.

Steps run in this order, chosen for their failure modes:

1. If the access token's `provider` claim is `apple`, read the stored Apple
   refresh token from Keycloak's `broker/apple/token` endpoint and revoke it at
   `appleid.apple.com/auth/revoke`. Apple requires this on account deletion, and
   the stored token becomes unreadable once the user is gone — so it goes first.
   A token Apple already rejects (`invalid_grant`) counts as revoked.
2. Erase the synced data, as above.
3. Delete the Keycloak user through the admin API.

The identity is removed **last** on purpose: any earlier failure leaves the
reader still signed in and able to retry the whole request, whereas deleting the
user first would strand rows under a subject that can no longer authenticate.

The route returns `503` without touching anything when the Keycloak admin
credentials (or, for Apple accounts, the Apple credentials) are missing, rather
than performing a partial deletion that silently leaves the account alive.

## Lifecycle rules

The API must retain accepted mutations for idempotency, retain delete
tombstones for 30 days, and reject non-restore mutations targeting a deleted
or prior generation. The server must use the same `sync-core` merge rules as
the extension; it must not replace a complete novel document.

## API lifecycle rules

`docs/api-versions.json` is the machine-checked lifecycle registry. An existing
major-version route contract is append-only until that version is retired.
Normal evolution is:

1. Add the new major version alongside the old one and mark the old version
   `supported`. Do not change the old handlers' behavior.
2. Release clients that use the new version across Chrome, Firefox, Safari
   macOS, and Safari iOS.
3. Keep the old version **supported, not deprecated**, while any known client
   still calls it. Store approval and automatic updates can take weeks.
4. After at least 90 continuous days with no old-version request, check every
   store's active-version/adoption evidence. Only a separate PR with owner
   approval, all four store checks, and an evidence document under
   `docs/api-retirements/` may mark it deprecated.
5. Keep a deprecated version operational for at least another 30 days with
   traffic still at zero before a separate retirement/removal PR.

`npm run api:compatibility` validates the current registry and code contract.
PR CI additionally compares it with protected `main`; it rejects deleted
version records, removed active routes, skipped lifecycle states, or missing
retirement evidence. A breaking change therefore ships as a new major API, not
as an in-place edit to a route installed extensions already use.

## Identity-provider setup

After the Keycloak container is available at the configured auth domain, add
Google under **Identity providers** in the `novel-tracker` realm.
Keep their client secrets in Keycloak's database/admin UI rather than in this
repository or the Docker Compose environment.

Apple is brokered the same way, as a generic OIDC provider with the alias
`apple`, so both sign-in buttons share one PKCE flow that differs only by
`kc_idp_hint` (see `AUTH_PROVIDERS` in `src/lib/config.js`). Because it is a
plain web OAuth flow, it works in Chrome and Firefox too, not only on Apple
platforms. `scripts/configure-keycloak.sh` creates it. Two details are not
optional:

- The authorization URL must carry `?response_mode=form_post`. Apple rejects
  the request otherwise whenever `name` or `email` is in scope, and Keycloak's
  generic OIDC provider has no field for the response mode.
- `storeToken` and `addReadTokenRoleOnCreate` must be on, or account deletion
  cannot read the Apple refresh token it has to revoke.

Apple's client secret is an ES256 JWT that expires within six months rather
than a fixed string (`server/apple-client-secret.js`). When it lapses, every
Apple sign-in fails in a way that reads like a Keycloak fault, so
`scripts/rotate-apple-secret.mjs` refreshes it on a timer.

Google and Apple are deliberately **separate accounts**, even for one person
with one email address, so each keeps its own synced library. The realm sets
`duplicateEmailsAllowed` with `loginWithEmailAllowed` off to stop Keycloak's
"account already exists" screen from interrupting the flow in an extension
popup — safe here because readers only ever authenticate through a provider.

The extension uses Authorization Code with PKCE. `novel-tracker-extension`
must have an audience mapper that adds `novel-tracker-api` to access tokens.
`scripts/configure-keycloak.sh` makes that mapper idempotently on deployment.
