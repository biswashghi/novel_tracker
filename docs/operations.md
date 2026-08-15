# Production operations

## Deploy

The Hetzner wrapper invokes `scripts/deploy-vps.sh`. Deployment waits for
Keycloak, configures the API audience mapper, installs the nightly backup timer,
and verifies the local and public health endpoints.

## Backups

`novel-tracker-backup.timer` creates a PostgreSQL custom-format backup every
night under `/var/backups/novel-tracker`. Files are mode `0600` and backups
older than 14 days are deleted.

Run and inspect a backup manually:

```bash
ssh deploy@178.156.141.165
sudo systemctl start novel-tracker-backup.service
sudo systemctl status novel-tracker-backup.service --no-pager
sudo ls -lh /var/backups/novel-tracker
```

Copy one backup off the VPS regularly. A backup kept only on the same VPS is
not sufficient disaster recovery.

## Restore drill

Use a disposable PostgreSQL container or staging deployment. Do not test a
restore over production data.

```bash
docker run --name novel-restore-test -e POSTGRES_PASSWORD=test-password -d postgres:17-alpine
docker cp novel-tracker-YYYYMMDDTHHMMSSZ.dump novel-restore-test:/tmp/backup.dump
docker exec novel-restore-test createdb -U postgres novel_tracker_restore
docker exec novel-restore-test pg_restore -U postgres -d novel_tracker_restore --no-owner /tmp/backup.dump
docker exec novel-restore-test psql -U postgres -d novel_tracker_restore -c 'select count(*) from sync_states;'
docker stop novel-restore-test
docker rm novel-restore-test
```

## Health checks

- API: `https://api.novel.bghimire.com/health`
- OIDC discovery: `https://auth.novel.bghimire.com/realms/novel-tracker/.well-known/openid-configuration`

Configure an external uptime monitor for both endpoints. The deployment smoke
test is not a substitute for continuous monitoring.

## Retention and deletion

Delete tombstones are synchronized for 30 days. The API cleanup job then purges
the novel, its mutation history, and canonical ID mappings. **Delete cloud
data** removes all synchronized records for the authenticated subject while
leaving the browser's local library intact.
