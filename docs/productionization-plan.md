# Novel Tracker productionization plan

## Implementation status

This document began as the 2026-09-04 audit. The implementation now resolves
the code-controlled release blockers it identified:

- public deploy/publish paths are disabled unless `RELEASES_ENABLED=true` and
  require an explicit production-environment approval;
- pull requests have one stable `PR Gate`, clean-stack authenticated tests,
  exact Chrome ZIP tests, all-platform packaging, shell/workflow validation,
  coverage floors, production dependency audit, and container scanning;
- releases require exact semver tags reachable from `main`, build packages
  once, and bind their SHA-256 values/version/commit in a verified manifest;
- the API image and its infrastructure images are digest-pinned, the API runs
  non-root with production container restrictions, and runtime dependencies
  have no known audit finding at the enforced severity;
- database changes are ordered, checksummed migrations; `/ready` verifies the
  database, schema, identity configuration, version, and commit;
- API v1 is explicit in every client and response; aggregate usage plus current
  four-store evidence blocks deprecation while any installed client depends on it;
- deployment requires an off-host pre-deploy backup, isolated restore proof,
  immutable-image readiness, and a health-verified rollback; restore drills
  also run weekly;
- third-party Actions and the Ruby/Apple toolchain are locked, with automated
  reviewed dependency updates configured.

The historical findings below remain useful as rationale, but no longer
describe the working tree. Remaining go-live items need external configuration
or human/platform evidence and are intentionally release-blocking:

1. re-enter publisher and VPS credentials as production-environment secrets,
   create separate staging credentials, then remove the repository-wide copies;
2. configure separate staging infrastructure and independent off-host rclone
   destinations for staging and production;
3. complete signed Chrome/Firefox and physical macOS/iPhone/iPad checks;
4. leave `RELEASES_ENABLED` false until those items and the scheduled readiness
   alert destination are confirmed.

## Decision summary

Use trunk-based development with four explicit gates:

1. **Local** — fast developer feedback and targeted manual checks.
2. **CI/QA** — a fresh, ephemeral Postgres + Keycloak + API stack for every
   pull request, plus all browser packages.
3. **Release candidate** — one immutable set of artifacts deployed to a
   persistent, production-like staging environment and beta distribution.
4. **Production** — promote those exact artifacts after approval; do not
   rebuild them.

This is four gates, but only two long-lived remote environments: staging and
production. Do not add long-lived `qa` or `staging` branches. Environment
identity belongs in deployment configuration, not in branches.

No process can prove that software has no defects. The objective is to make
errors hard to introduce, likely to be caught before release, limited in blast
radius, immediately visible, and quick to reverse.

## Current-state assessment (2026-09-04)

### What is already strong

- One semver release identity drives Chrome, Firefox, macOS Safari, and iOS
  Safari; Apple's build number is deterministic and separate.
- Unit tests cover the sync merge rules, mutation rejection, authentication,
  storage, parser behavior, versioning, and account-deletion helpers.
- Playwright loads the real unpacked Chromium extension and exercises local
  library, sync, conflict, and account-deletion flows against real Postgres,
  Keycloak, and the API.
- The backend candidate is built once as a container and deployed by immutable
  image digest after an ephemeral integration run.
- Backend deployment has a lock, health checks, a previous-image rollback path,
  and tests for successful and failed orchestration.
- Firefox gets `web-ext` validation; Safari gets an Xcode compile check; failed
  browser runs retain traces, screenshots, and video.
- Production currently responds at both the API health endpoint and OIDC
  discovery endpoint.

### Release-blocking gaps

| Gap | Evidence | Risk |
| --- | --- | --- |
| `main` is unprotected | GitHub reports no branch protection and no repository ruleset | Code can bypass review and every CI check |
| Production is unprotected | The GitHub `production` environment has no reviewers, wait timer, or branch policy | A merge to `main` can deploy the API without a deliberate promotion decision |
| Tags publish immediately | `release.yml` publishes on any `v*` or `*.*.*` tag | A tag from the wrong branch, mismatched version, or unqualified commit can reach stores |
| PR checks omit the full integration suite | `pr.yml` runs unit tests and packages, but not `make staging-test` | Auth/sync defects can first appear after the release tag exists |
| The ordinary test command can hide integration coverage | `tests/server-sync-api.test.mjs` skips when the stack is absent; the current local unit run was 93 pass / 1 skip | A green `npm test` can be mistaken for full verification |
| The current candidate is not green end-to-end | A clean local `make staging-test` run passed 8/9 Playwright tests but account deletion returned a reusable login after the API reported success | The current hotfix branch is not a releasable candidate yet |
| Release publication can be partial | The `v1.0.2` run passed tests, Chrome packaging, Safari packaging, and Safari upload, but Firefox packaging failed AMO validation | Store versions can diverge without an explicit release ledger and recovery decision |
| Backend and extension releases are not ordered | The API deploy and tag-triggered store workflow run independently | A new client can become available before its compatible server change is healthy |
| Backend path filters omit shared runtime code | The server image copies `src/`, but `deploy.yml` does not include `src/lib/sync-core.js` or other shared server dependencies | A merge can change server behavior without rebuilding/deploying the server |
| Production dependencies have known vulnerabilities | `npm audit --omit=dev` reports one moderate and two high findings (`fastify`, `fast-uri`, and `sharp`) | Known fixable risk can ship; `sharp` is build tooling but is installed in the production image |
| Live-site monitoring is continuously red | The latest five scheduled Chikari runs failed because expected reader elements were absent | Alert fatigue makes a real compatibility regression easier to miss |

### Important second-tier gaps

- API schema changes run as startup DDL in `server/index.js`; there is no
  versioned migration ledger, forward/backward migration test, or explicit
  migration job.
- `/health` only returns `{ok:true}`. It does not prove Postgres connectivity,
  schema readiness, or usable Keycloak/JWKS configuration.
- The rollback restores only the previous API image. It does not restore the
  previous Compose/configuration files, undo a schema or Keycloak change, or
  verify that rollback became healthy.
- Backups remain on the same VPS. The documentation recommends copying them
  elsewhere, but that is not automated and restore success is not monitored.
- There is no ESLint/Prettier check, ShellCheck, actionlint, secrets scan,
  automated dependency update policy, or enforced vulnerability gate.
- GitHub Actions and base images use floating tags; SHA pinning is disabled.
  Fastlane is installed without a locked Gemfile.
- Node 20 is used for extension/release jobs while the API and deploy jobs use
  Node 22. There is no checked-in Node version or `engines` declaration.
- Measured unit coverage is about 89.6% lines and 76.2% branches for loaded
  modules, but that excludes meaningful portions of the UI/background and the
  running server. `sync-service.js` is only 50% line-covered. A global number
  would therefore overstate confidence.
- Live compatibility checks cover only Chikari, while nine sites are declared
  as supported.
- There is no release manifest tying version, Git SHA, image digest, browser
  artifact hashes, Xcode version, checks, rollout status, and store versions
  together.

## Target environment model

| Gate | Data and services | Build under test | Required exit condition |
| --- | --- | --- | --- |
| Local | Local containers and disposable test users | Developer build | Targeted tests pass; no unexpected working-tree changes |
| CI/QA | Fresh containers and unique users per spec/run | PR-versioned packages and candidate API image | Required aggregate check is green with zero unexpected skips |
| Release candidate | Persistent staging domains, isolated database/realm, real external OAuth test clients, internal store testers | Exact production image digest and exact versioned artifacts | Automated staging checks plus human platform checklist signed off |
| Production | Real domains, identities, and user data | The exact approved digests/hashes | Readiness, synthetic transaction, metrics, and rollout health remain within thresholds |

### Local gate

Provide two documented commands:

- `npm run verify:quick`: format check, lint, static syntax checks, unit tests,
  manifest tests, and source/config validation. Target: under two minutes.
- `npm run verify:full`: quick checks, a clean ephemeral stack, API integration,
  Chromium extension E2E, Chrome/Firefox packaging and validation, and Safari
  build/compile when running on macOS.

Local credentials must remain visibly fake. `verify:full` must always destroy
its volumes and must fail, not skip, if Docker or a required browser is absent.
Keep targeted commands for iteration, but document that they are not release
evidence.

### CI/QA gate

Run on every pull request that can affect any shipped component. Use path
filtering only to skip clearly unrelated expensive jobs; never use it for the
aggregate correctness gate.

Required jobs:

1. **Source quality** — locked dependency install, formatting, lint, Node
   syntax, JSON/YAML validation, ShellCheck, actionlint, and generated-file
   drift checks.
2. **Unit/domain** — unit tests with critical-module coverage thresholds and a
   machine-readable report. Treat all unexpected skips as failures.
3. **API integration** — real Postgres and Keycloak, schema migration from an
   empty database and from supported old schema fixtures, auth, limits,
   deletion, and sync contract tests.
4. **Extension E2E** — the packaged Chrome artifact, not a separately rebuilt
   directory, against the fresh stack. Use a unique Keycloak user per spec so
   tests can run independently and deletion cannot affect other cases.
5. **Package matrix** — Chrome manifest/package validation, Firefox
   `web-ext lint`, Safari packaging, and unsigned macOS/iOS compilation.
6. **Compatibility** — current released client against the candidate API and
   candidate client against the currently released API contract. A coordinated
   change must pass both until adoption permits cleanup.
7. **Security/supply chain** — production dependency audit, secret scanning,
   container filesystem scan, SBOM generation, and license-policy check.
8. **Required aggregate** — one stable `PR Gate` job that depends on every
   applicable required job. Protect `main` against this job name so workflow
   refactors do not silently weaken protection.

Third-party live sites must not block a code release when they are themselves
unavailable or blocking automation. Fixture-based parser conformance is the PR
gate; live-site probes are post-merge signals that create actionable alerts.

### Release-candidate gate

A merge to `main` should build, identify, and retain one candidate:

- API image by digest.
- Chrome ZIP by SHA-256.
- Firefox source ZIP and returned signed artifact/status by SHA-256.
- Generated Safari project and signed macOS/iOS archives by SHA-256.
- `release-manifest.json` containing version, Git SHA, Apple build number,
  toolchain versions, artifact hashes, image digest, migration version, CI run
  links, and supported client/API ranges.
- SBOMs and provenance attestations for the API image and distributable
  packages.

Deploy the candidate API digest to persistent staging. Staging needs separate
DNS, database, Keycloak realm, OAuth clients, Apple/Google test accounts,
secrets, and backups. It should use the production Compose topology and the
same migration mechanism, with smaller capacity only.

Exercise:

- Google and Apple sign-in, refresh, sign-out, and account deletion.
- First sync, two-device conflict convergence, offline replay, import/export,
  restore, and upgrade from stored-state fixtures for each supported released
  client version.
- Chrome and Firefox signed/beta builds where practical.
- The exact Safari build through internal TestFlight on iPhone/iPad, plus the
  macOS archive on a clean test account.
- Caddy/TLS, OAuth callbacks for every public extension ID, backup execution,
  restore into a disposable database, and rollback to the previous digest.

Release candidate is a state, not a rebuild. Any code, dependency, config, or
migration change invalidates approval and produces a new candidate.

### Production gate

Production deployment must be a manual promotion through the protected GitHub
environment. Only `main` and release tags reachable from `main` may deploy.
Use a concurrency group that never allows two releases to publish or deploy out
of order.

For coordinated API/client changes:

1. Deploy an additive, backward-compatible API first.
2. Verify readiness and a synthetic authenticated sync on production with a
   dedicated non-user account.
3. Observe for a defined bake period (normally 30–60 minutes; longer for data
   migrations).
4. Release the exact approved client artifacts first to internal/beta testers,
   then public stores.
5. Pause or phase rollout where the store supports it.
6. Keep old API behavior until published-version telemetry or a conservative
   time window shows that old clients no longer need it.
7. Remove compatibility code in a later release, never in the same release that
   introduces its replacement.

For extension-only changes, skip the API deploy but retain signed-artifact
verification. For API-only changes, retain old-client compatibility checks.

## Change classification and required evidence

Every pull request should carry exactly one release-risk label.

| Class | Examples | Extra evidence |
| --- | --- | --- |
| Low | Copy, CSS, docs, test-only changes | Visual/manual check for user-facing copy or layout |
| Medium | Parser, local storage, extension UI, non-destructive API behavior | Relevant E2E, upgrade fixture, package matrix |
| High | Auth, sync merge rules, account deletion, schema, deployment, permissions | Two-person review where available, compatibility matrix, staging sign-off, rollback rehearsal |
| Emergency | Active outage or security issue | Narrow fix, automated regression, explicit incident record, follow-up review within one business day |

The PR template should record user impact, affected platforms, data/schema
impact, compatibility direction, test evidence, rollout plan, rollback/forward
fix, observability, and documentation/privacy changes.

## Test strategy

### 1. Deterministic tests required on each PR

- Keep the sync-core examples and add property/fuzz tests for convergence,
  commutativity where expected, idempotency, deletion generations, malformed
  payloads, future clocks, and large histories.
- Add stored-state compatibility fixtures from every still-supported public
  version (at minimum 0.3.4, 1.0.0, 1.0.1, and 1.0.2 initially). Assert upgrade,
  materialization, sync, export, and re-import without data loss.
- Build a parser fixture corpus for every supported site with chapter, novel
  home, blocked/partial DOM, changed heading, and unsupported page examples.
  Sanitize and date each fixture.
- Test UI/background error paths: failed storage, rejected runtime message,
  expired auth, network offline, partial sync rejection, rate limit, and account
  deletion failure. A failed destructive operation must never be rendered as
  success.
- Add accessibility checks for popup/options: keyboard operation, focus,
  labels, contrast, zoom, and screen-reader names.
- Add package-content assertions: no local endpoints, source maps, secrets,
  test credentials, unexpected permissions, or unapproved hosts in production
  ZIPs.

### 2. Integration tests required on each PR

- Start from empty volumes and run migrations before tests.
- Do not let API integration silently skip inside `npm test`; give it a separate
  command whose missing prerequisites are fatal in CI.
- Allocate a unique user per test or create/delete users through test setup.
- Assert database side effects, not only UI text or HTTP status.
- For account deletion, assert the exact authenticated subject is removed via
  the Keycloak admin API and that a fresh credential grant fails. Capture the
  subject and deletion response in safe test diagnostics.
- Test failure injection: Postgres unavailable, Keycloak unavailable, JWKS
  refresh, timeout between sync transaction steps, duplicate requests, and
  process termination during a request.

### 3. Platform checks

| Platform | Automated | Release-candidate manual |
| --- | --- | --- |
| Chrome/Edge | Load the unpacked exact ZIP; library/parser/auth/sync E2E; manifest policy | Signed store build, Google/Apple callbacks, update from previous public version |
| Firefox desktop/Android | Build/package assertions and locked `web-ext lint`; shared domain tests | Signed AMO/beta build on desktop and Android, callbacks, permissions, update |
| Safari macOS | Package, Xcode compile, archive/export/sign validation | Clean install/update, enablement, both providers, sync, account deletion |
| Safari iOS/iPadOS | Simulator compile and native bridge contract tests | Exact TestFlight build on physical phone and tablet; background/foreground token behavior |

### 4. Scheduled tests

- Daily: production readiness and a non-destructive authenticated sync
  synthetic; parser probes for all supported sites.
- Weekly: dependency/container scans, backup freshness, restored database
  smoke, token/certificate expiry checks, and current-public-client compatibility.
- Monthly: full restore drill into isolation, previous-version upgrade matrix,
  rollback exercise, access review, and alert routing test.
- Quarterly: disaster-recovery exercise, secret rotation, threat-model review,
  and pruning of unsupported client versions.

## Release mechanics

### Protect source and release identity

Configure a `main` ruleset:

- Require a pull request and the `PR Gate` check.
- Require the branch to be current before merge.
- Block force pushes and branch deletion; require linear history.
- Require conversation resolution and one approval for high-risk changes when
  another maintainer is available. A solo-maintainer workflow should still
  require the PR and automated gate rather than pretending self-approval adds
  safety.
- Restrict bypass to an emergency role and audit every bypass.

Configure tag protection for `vMAJOR.MINOR.PATCH`. The release workflow must
fail unless the tag is an exact semver match for `package.json`, points to a
commit reachable from `main`, and has a successful candidate record for that
SHA.

Prepare a version in a release PR with `npm version <level>
--no-git-tag-version`, then tag the merged `main` commit. Update `AGENTS.md` and
`docs/release.md` together when adopting this change so the documented source
of truth remains unambiguous.

### Build once, promote many

- Build distributables once after the release commit is fixed.
- Run tests against unpacked copies of those artifacts.
- Store hashes and sign provenance.
- Upload to beta/draft channels without public release.
- Publish/promote only the recorded hashes after approval.
- Retain release artifacts and manifests for at least the support lifetime, not
  only 14 days. Attach them to an immutable GitHub Release where licensing and
  store rules permit.

Separate `upload` from `publish` for every store. Per-store failures may remain
independent, but the release dashboard must show a deliberate state for each:
`not started`, `candidate uploaded`, `in review`, `public`, `paused`, `failed`,
or `superseded`. A release is complete only when every intended platform is
public or explicitly waived.

### Database changes

- Introduce timestamped/versioned migration files and a `schema_migrations`
  ledger.
- Run migrations as a single deployment job under a database advisory lock,
  before starting code that requires the new schema.
- Use expand/migrate/contract changes: add compatible schema, backfill safely,
  deploy readers/writers, then remove old schema in a later release.
- Test every migration from the oldest supported production schema and on a
  production-sized synthetic dataset. Record duration and lock behavior.
- Never rely on an API-image rollback to reverse a destructive migration.
  Destructive changes require an explicit restore or forward-repair plan.

## Deployment, rollback, and recovery

### Backend deployment

Improve the existing digest deployment as follows:

1. Snapshot the current image digest, Compose files, route, Keycloak
   configuration version, and schema version into a release directory.
2. Verify an off-host backup and migration preconditions.
3. Pull the candidate by digest and run migrations.
4. Start the candidate and wait on `/ready`, not `/health` alone.
5. Run authenticated smoke/synthetic checks.
6. Switch traffic or complete the Compose replacement.
7. Observe error/latency/sync-rejection thresholds during the bake window.
8. On failure, restore the prior configuration and image, verify readiness and
   the synthetic transaction, and report rollback failure as a separate page.

For the current single-host scale, a brief replacement is acceptable if its
expected downtime is written down. If near-zero downtime becomes a requirement,
add blue/green API containers behind Caddy before adding general orchestration
complexity.

### Store rollback

Store distribution cannot be rolled back as quickly as a server:

- Prefer rollout pause and forward-fix with a new semver.
- Keep server behavior backward compatible with both the bad/new client and the
  prior client.
- Put risky server-dependent features behind a server-controlled capability or
  kill switch that defaults off for unknown versions.
- Preserve previous signed artifacts and store metadata for emergency analysis.

### Backups and disaster recovery

Define initial objectives: **RPO 24 hours** and **RTO 4 hours**, then revise
from real usage needs.

- Encrypt and copy nightly Postgres backups to a different provider/account or
  object store with retention and immutability.
- Monitor backup age, size anomalies, upload success, and restore success.
- Retain daily backups for 30 days and monthly backups for 12 months initially.
- Test both Novel Tracker data and Keycloak identity restoration.
- Keep infrastructure bootstrap, DNS, Caddy, environment-variable inventory,
  and secret-recovery instructions in the runbook.

## Observability and operational controls

Split endpoints:

- `/health`: process liveness only; no external dependency.
- `/ready`: database connection, expected schema version, and required runtime
  configuration. Keep outbound identity-provider checks in synthetics so a
  third-party outage does not restart healthy processes.

Record, without novel titles, chapter URLs, email addresses, tokens, or raw
mutation bodies:

- request count, status, and latency by route;
- auth failures and JWKS refresh failures;
- sync batch size, applied/duplicate/rejected counts, and pull page depth;
- database pool saturation, query errors, migration version, and cleanup time;
- deployment version/SHA/image digest;
- backup age and restore-test result;
- Apple secret/certificate/profile expiry windows;
- public client version/platform when supplied in a privacy-safe header.

Initial service objectives:

- 99.9% monthly successful API availability excluding planned maintenance.
- 99% of successful sync API requests under one second at current scale.
- Fewer than 0.1% unexpected server errors over 15 minutes.
- Zero sustained rejected-mutation increase after a release.
- Backup no older than 26 hours and a successful restore drill no older than 35
  days.

Alert only on actionable symptoms with an owner and runbook. Live-site probes
must distinguish site unavailable/blocked, selector changed, and extension
behavior failed. Five consecutive red daily runs should open/escalate one
incident rather than create five ignored notifications.

If remote client error reporting is added, make it privacy-preserving and align
the privacy policy/store declarations before collection. A no-telemetry option
is an in-app diagnostics export containing version, platform, coarse error
codes, and timestamps with user review before sharing.

## Security and supply-chain baseline

Immediate actions:

- Upgrade to fixed `fastify`/`fast-uri` versions and regression-test request
  validation.
- Move `sharp` to development-only dependencies if runtime code does not use it,
  so the API image neither installs nor ships its vulnerable libvips build;
  then upgrade it independently for asset generation.
- Enable GitHub dependency/vulnerability alerts and weekly update pull requests.
- Fail CI on new critical/high production findings; require a documented,
  expiring exception for an unexploitable finding.

Baseline hardening:

- Pin third-party Actions to commit SHAs and enable required SHA pinning.
- Pin Node, Postgres, Keycloak, and other image digests; update them through
  reviewed automation.
- Add `.node-version`/`.nvmrc` and `package.json.engines`; use Node 22 throughout
  unless a store tool requires otherwise.
- Lock Fastlane and Ruby dependencies with `Gemfile.lock` and record Xcode/macOS
  runner versions in the release manifest.
- Keep explicit minimum GitHub token permissions per job. Replace long-lived
  cloud credentials with short-lived federation where supported; rotate SSH and
  store credentials on schedule.
- Add secret scanning, container scanning, SBOMs, provenance, and a documented
  security-reporting route.
- Run the API as a non-root user in a read-only container filesystem where
  practical, drop Linux capabilities, and set CPU/memory/PID limits.

## Implementation roadmap

### Phase 0 — stop unsafe releases (immediate, 1–2 days)

- Do not release the current hotfix until the account-deletion E2E failure is
  reproduced, explained, fixed, and rerun cleanly.
- Protect `main`; add the stable required `PR Gate` job.
- Protect the production environment and tags; add release concurrency.
- Make tag validation strict and separate candidate upload from public publish.
- Add all shared server runtime files, especially `src/lib/**`, to backend
  change detection (or compute affected components from the Docker build
  context).
- Put `make staging-test` in PR CI and make unexpected test skips fatal.
- Upgrade the vulnerable production dependency chain and remove `sharp` from
  the runtime image.
- Repair or suspend the noisy Chikari monitor until it distinguishes site
  blocking from parser failure and alerts an owner.

**Exit:** no direct or unchecked merge to `main`; no automatic public release
from an arbitrary tag; full clean-stack PR integration is green; production
dependency audit has no unaccepted high/critical finding.

### Phase 1 — deterministic candidate pipeline (week 1)

- Add quick/full verification commands and lint/format/shell/workflow checks.
- Consolidate CI around the required aggregate gate.
- Test the exact Chrome ZIP and add package-content safety assertions.
- Create unique integration users and make deletion assertions inspect the
  exact subject.
- Add release manifest, artifact hashes, longer retention, and per-store status.
- Align on Node 22 and lock web-ext/Fastlane/tool versions.

**Exit:** one candidate SHA maps to one reproducible, traceable artifact set;
all required evidence is visible from one PR/release summary.

### Phase 2 — real staging and safe data evolution (weeks 2–3)

- Provision isolated staging DNS, realm, database, OAuth clients, secrets, and
  test accounts.
- Change `main` deployment from production to staging.
- Add protected manual promotion of the tested image digest to production.
- Introduce versioned migrations and old-schema/stored-state fixtures.
- Add released-client/candidate-server compatibility tests.
- Exercise signed Chrome/Firefox candidates and exact TestFlight builds.

**Exit:** production receives only an approved digest already exercised with
real OAuth and store signing; schema compatibility is tested rather than
assumed.

### Phase 3 — recovery and observability (weeks 3–4)

- Add `/ready`, metrics/log dashboards, release markers, synthetics, SLOs, and
  actionable alerts.
- Make rollback restore configuration and verify the recovered service.
- Automate encrypted off-host backups and monthly restore drills.
- Add feature/capability kill switches for risky coordinated changes.

**Exit:** a bad backend release is detected and reversed within the stated RTO;
backup and restore evidence is current; operators can identify release impact
without inspecting user content.

### Phase 4 — broaden compatibility confidence (month 2)

- Complete fixture coverage for all supported reading sites.
- Add property/fuzz tests for sync and failure-injection tests for API/auth.
- Add accessibility and previous-version update coverage.
- Review whether scale, traffic, or SLO evidence justifies blue/green deploys,
  shared rate limiting, managed Postgres, or a second API replica.

**Exit:** regression detection covers every advertised platform/site and every
supported data version; infrastructure complexity grows only in response to a
measured need.

## Release checklist

### Before merge

- [ ] Risk label and affected components/platforms are correct.
- [ ] User/data/privacy/security impact is documented.
- [ ] `PR Gate` passes with no unexpected skips.
- [ ] Compatibility and migration evidence is attached when applicable.
- [ ] Rollout, rollback/forward-fix, and observable success criteria are stated.

### Candidate

- [ ] Version equals the intended tag; tag commit is on `main`.
- [ ] Image digest and all artifact hashes are in the release manifest.
- [ ] Staging automated suite passes on exact artifacts.
- [ ] Google/Apple auth and callbacks pass.
- [ ] Required Chrome, Firefox, macOS, iPhone, and iPad manual checks pass.
- [ ] Backup/restore and rollback evidence is current for high-risk releases.
- [ ] Release notes, support notes, privacy declarations, and store metadata are
      accurate.

### Production

- [ ] Protected-environment approval is recorded.
- [ ] Backward-compatible API is deployed and ready before dependent clients.
- [ ] Authenticated production synthetic passes.
- [ ] Beta/internal rollout is healthy.
- [ ] Public rollout state is recorded separately for every store/platform.
- [ ] Error, latency, rejection, auth, and support signals are watched through
      the bake window.
- [ ] Release is closed only when every intended platform is public or waived.

## Process metrics

Review monthly:

- change failure rate and rollback/forward-fix rate;
- escaped defects by platform and test layer that should have caught them;
- median PR-to-staging and staging-to-production time;
- flaky-test rate and unexpected skips;
- mean time to detect and recover;
- percentage of releases with complete manifests and manual sign-off;
- backup/restore compliance;
- age of high/critical vulnerabilities;
- public client-version distribution and cross-store version lag.

The process is improving when release confidence rises without a growing manual
checklist, failures are caught earlier, and recovery evidence is routine rather
than created during an incident.
