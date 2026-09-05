# Production operations

## Deploy

The provider-neutral shared VPS platform must be bootstrapped once on separate
staging and production hosts before deployment. Every push to `main` builds and
tests an immutable API candidate. When `STAGING_TARGET_CONFIGURED=true`, that
exact digest is then deployed automatically through the GitHub `staging`
environment. Staging has its own host, DNS, database, Keycloak realm, OAuth
clients, secrets, and off-host backup target; it must never share production
state.

Production deployment requires a manual `workflow_dispatch` with
`deploy_to_production=true`, both target-configured variables,
`RELEASES_ENABLED=true`, a successful redeployment of the existing main-build
digest to persistent staging, and approval in the protected GitHub `production`
environment. The manual run resolves the already-built digest by commit tag and
does not rebuild it. Deployment updates only the `novel-tracker`
Compose project and `/opt/shared-caddy/apps/novel-tracker.caddy`; it never recreates
the proxy. It waits for Keycloak, configures the API audience mapper, repairs the
known Chrome, Firefox, and Safari extension callbacks, installs the nightly backup
and restore-verification timers, and verifies local/public readiness plus the
expected Git commit reported by the running image.

The local `scripts/deploy-vps.sh` is limited to validation and upload. The
complete VPS sequence is readable in `scripts/remote/deploy-production.sh`,
with routing in `deploy/novel-tracker.caddy.template`.
`make deployment-test` exercises both successful orchestration and rollback
after failed public verification.

The Compose project name changed from the implicit `infra` name, but the Postgres
volume remains explicitly named `infra_postgres-data`. Do not rename that volume:
it contains both synchronized novel state and Keycloak identity data. The first new
deployment shuts down the old `infra` project without `--volumes` before starting
the named project, preventing concurrent PostgreSQL access to that volume.
Both remote environments use `compose.yml` with `compose.production.yml` on
their respective hosts. Scripts read secrets directly from root-owned
`/etc/novel-tracker/app.env`; they never copy the file into the Git checkout.

Configure the `staging` GitHub environment with the same variable/secret names
used by `production` (`NOVEL_API_DOMAIN`, `NOVEL_AUTH_DOMAIN`, `VPS_HOST`,
`VPS_USER`, `VPS_SSH_KEY`, and preferably pinned `VPS_KNOWN_HOSTS`), but with
staging-only values. Set `STAGING_TARGET_CONFIGURED=true` only after its host and
off-host restore proof work. Keep `RELEASES_ENABLED` absent until all release
readiness evidence is complete.

## Backups

`novel-tracker-backup.timer` creates a PostgreSQL custom-format backup every
night under `/var/backups/novel-tracker`. Each dump has a SHA-256 sidecar,
files are mode `0600`, and backups older than 14 days are deleted. Production
backups require `NOVEL_BACKUP_RCLONE_REMOTE` in
`/etc/novel-tracker/app.env`; it must name storage in a different provider or
failure domain. `rclone` and its restricted configuration must be installed on
the VPS. Set `NOVEL_BACKUP_REQUIRE_OFFSITE=0` only for local recovery testing.

Every deployment of an existing database blocks until a fresh backup is copied
off-host and restored successfully into an isolated PostgreSQL container.
`novel-tracker-backup-verify.timer` repeats the restore drill weekly.

Run and inspect a backup manually:

```bash
ssh deploy@178.156.141.165
sudo systemctl start novel-tracker-backup.service
sudo systemctl status novel-tracker-backup.service --no-pager
sudo ls -lh /var/backups/novel-tracker
```

Inspect the most recent restore drill with:

```bash
sudo systemctl status novel-tracker-backup-verify.service --no-pager
sudo journalctl -u novel-tracker-backup-verify.service --since '8 days ago'
```

## Restore drill

The checked-in verifier always uses a disposable PostgreSQL container and never
restores over production data:

```bash
sudo /opt/novel-tracker/scripts/verify-backup.sh
```

## Health checks

- API liveness: `https://api.novel.bghimire.com/health`
- API readiness: `https://api.novel.bghimire.com/ready`
- OIDC discovery: `https://auth.novel.bghimire.com/realms/novel-tracker/.well-known/openid-configuration`

`/health` proves only that the process can answer. `/ready` also proves database
connectivity, required identity configuration, the migration version, and the
running app version/commit. Configure an external uptime monitor for readiness
and OIDC discovery. The deployment smoke test is not continuous monitoring.

## Scaling limits

These hold for the current single-container deployment and are the first things
to revisit before scaling out.

**Rate limiting is per process.** `requestWindows` in `server/index.js` is an
in-memory `Map` keyed by subject (120 requests/minute). Running more than one
API container multiplies the effective limit by the container count; horizontal
scaling needs a shared store or a gateway-level limiter instead.

**Schema.** Ordered SQL files in `server/migrations/` are checksummed in the
`schema_migrations` table and run under an advisory lock. Never edit an applied
migration; add the next numbered file and use expand/migrate/contract changes.
`sync_mutations` carries `idx_sync_mutations_subject_sequence`,
which serves the pull query (`WHERE subject = $1 AND sequence > $2 ORDER BY
sequence`). It is created by the bootstrap DDL, so a redeploy is enough to add
it to an existing database. There is deliberately no index on
`mutation->>'novelId'`: the only query that filters on it is the daily tombstone
purge, which is not worth taxing the hot insert path for.

**Request limits.** At most 500 mutations per batch and 8 KB of JSON per
mutation; the Fastify `bodyLimit` is derived from those two so a worst-case
legal batch is never refused before per-item validation. Raising either
constant raises the body limit automatically.

**Tombstone purge.** The daily job walks subjects in keyset-paginated chunks of
100, taking the same per-subject advisory lock the mutation path uses. It no
longer holds one transaction across every user.

**Shutdown.** SIGTERM/SIGINT drain in-flight requests via `app.close()` and then
close the pool, with a 10-second backstop that force-exits rather than waiting
for the container runtime's SIGKILL.

## Retention and deletion

Delete tombstones are synchronized for 30 days. The API cleanup job then purges
the novel, its mutation history, and canonical ID mappings.

`DELETE /v1/account/data` removes all synchronized records for the authenticated
subject while leaving the browser's local library intact.

`DELETE /v1/account` deletes the account itself, as App Store guideline 5.1.1(v)
requires: it revokes the Apple token for Apple-created accounts, erases the
synced data, and then removes the Keycloak user — in that order, so any failure
short of the last step leaves the reader able to retry. It returns `503` without
touching anything when the credentials below are missing, rather than performing
a partial deletion that leaves the account alive. The local library is never
touched.

## Identity providers

Google and Apple are both brokered through Keycloak, so one PKCE flow serves
both and Apple sign-in works in every browser rather than only on Apple
platforms. Readers who use both end up with two separate accounts and two
separate libraries; the realm sets `duplicateEmailsAllowed` with
`loginWithEmailAllowed` off so a shared email address does not interrupt the
flow with Keycloak's "account already exists" screen.

`/etc/novel-tracker/app.env` must carry:

| Variable | Purpose |
| --- | --- |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` | Service-account client with `realm-management` roles `manage-users` and `manage-identity-providers`, used to delete Keycloak users and create or refresh the Apple provider |
| `KEYCLOAK_ADMIN_URL` | Optional; container-internal Keycloak address, for the same reason `KEYCLOAK_JWKS_URL` exists |
| `APPLE_TEAM_ID`, `APPLE_SERVICES_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Sign in with Apple credentials, used to revoke Apple tokens and to mint the provider's client secret |

`APPLE_SERVICES_ID` is the Services ID from the Apple Developer portal, not the
app's bundle identifier, and its return URL must be
`https://auth.novel.bghimire.com/realms/novel-tracker/broker/apple/endpoint`.

**Apple's client secret expires within six months.** It is an ES256 JWT rather
than a fixed string, and when it lapses every Apple sign-in fails in a way that
looks like a Keycloak broker fault rather than an expiry.
Production deployment runs `scripts/rotate-apple-secret.mjs` once immediately:
the first run creates the `apple` identity provider, while later deployments
refresh its client secret. `novel-tracker-apple-secret.timer` runs the same
one-shot container monthly so the secret cannot reach Apple's expiry ceiling.
Run `npm run keycloak:apple` from a complete repository checkout after changing
any `APPLE_*` value when an out-of-band refresh is needed.
