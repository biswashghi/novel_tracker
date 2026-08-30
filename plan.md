# Novel Tracker — Remediation & Feature Plan

Full codebase review findings and the approved execution plan, **revised
after external review** (poison-pill sync bug promoted; 1.2 redesigned and
scoped down; 1.6 simplified to a deletion; 2.3 livelock fixed; already-done
items removed). Covers four store targets (Chrome, Firefox AMO, Safari
macOS/iOS), the sync API server (`server/index.js`), build scripts, tests,
and CI.

Baseline: `npm test` reports **78 passing** with the local stack up — 70 unit
tests plus 8 `server-sync-api` tests that skip themselves when Docker isn't
running. **9 Playwright e2e specs** pass on top of that, now headless (Chrome's
new headless mode loads extensions; `npm run test:e2e:headed` still watches).

## Status

| Item | State |
|---|---|
| 1.1 single-writer refactor | **Done** (reads deliberately left direct — see note) |
| 1.2 bounded `appliedMutations` | **Done** + follow-up crash fix (see 1.8) |
| 1.3 refresh single-flight + skew | **Done** |
| 1.4 localStorage fallback | **Done** |
| 1.5 unify duplicate detection | **Done** |
| 1.6 delete the label sort | **Done** |
| 1.7 poison-pill rejections | **Done**, extended with a positional `index` |
| 1.8 stripped-state crash *(new)* | **Done** — see below |
| 1.9 quadratic replay *(new)* | **Done** — see below |
| 2.1 `(subject, sequence)` index | **Done** |
| 2.2 graceful shutdown | **Done** |
| 2.3 chunked purge | **Done** |
| 2.4 bodyLimit vs batch size | **Done, revised** — limits reconciled (see note) |
| 2.5 document limits | **Done** — `docs/operations.md` |
| 2.6 push response slimming | **Done** |
| 3.1 drop `tabs` | **Done**, with a negative manifest assertion |
| 3.2 ESLint + Prettier | **Not started** |
| 3.3 docs refresh | **Done** |
| Phase 4 features | **Not started** |

### 1.8 Stripped canonical state crashed the client (NEW — found in review of 1.2/2.6)

1.2 strips `appliedMutations` before persisting, but the same object is what
`POST /v1/sync/mutations` returns, so the field was stripped **on the wire**
too. `adoptCanonicalState` spread that blob straight into local state and
`applyMutation` then read `state.appliedMutations[...]` on `undefined`.

Reproduced against the live stack: the response carries
`['version','deviceId','clock','novels','pendingMutations']` and a push with
any unacknowledged pending mutation threw `Cannot read properties of
undefined`. The trigger is a *rejection* (1.7's own output), and the broken
state persisted — so every later pull threw too. That is the same permanent
wedge 1.7 exists to remove.

**Fix.** Default the map in `applyMutation` (states from the server never carry
it) and restore it explicitly in `adoptCanonicalState`. The unit mocks were
building server responses with `createSyncState()`, which *includes* the field,
so they tested a payload the server never sends; they now strip it, and a
regression test asserts a stripped blob stays replayable.

### 1.9 Replay was quadratic in batch size (NEW)

`applyMutation` deep-clones the whole state per call and `chooseHead` rescanned
all of `chapterHistory` per checkpoint, so a first-sync pull was O(n²) twice
over — 6,001 mutations took **20.2s** of blocking work in the service worker.
`applyMutationBatch` now clones once and mutates a single working copy, and
`chooseHead` tracks a running maximum (events are immutable once recorded, so a
new checkpoint only has to beat the incumbent). Same batch: **22ms**. The unit
suite went from 21.9s to ~0.25s as a side effect.

### Deviations from this plan, and why

- **1.1 reads stay direct.** The plan routed `:get-novels`/`:export-json`
  through the background "so previews observe a consistent snapshot", but
  `getNovels()` is a single atomic `storage.get` and is already consistent;
  the hop would add latency to every options render for no ordering benefit
  (an awaited write has already resolved before the caller re-reads). Writes
  only: `library-upsert`, `library-update`, `library-delete`,
  `library-restore`, `library-import`, and `auto-progress`.
- **2.4 limits.** The plan's pairing (4MB body, 32KB per mutation) still does
  not reconcile: 500 x 32KB is 16MB, so a worst-case legal batch would still
  die on a body-size error. Per-mutation is now **8KB** (notes cap at 4,000
  chars and tags at 20x40, so legal mutations are far below it) and the body
  limit is **derived** — `MAX_MUTATIONS_PER_BATCH * MAX_MUTATION_JSON_BYTES +
  64KB` — so the two can never drift apart again. Size is measured in bytes
  (`Buffer.byteLength`), not UTF-16 units.
- **1.7 reports a positional `index`.** Matching rejections by `mutationId`
  alone cannot identify the one mutation rejected *for having no usable id* —
  it would stay pending forever, which is the exact bug. Clients match on
  index first.

---

## Phase 1 — Correctness bug fixes (highest value)

### 1.1 Single-writer refactor for library mutations

**Problem.** Three extension contexts independently read-modify-write the
entire sync-state blob in `chrome.storage.local`: `src/background.js`
(`autoUpdateNovelProgress`), `src/popup.js` (`upsertNovel` directly), and
`src/options.js` (`updateNovel`/`deleteNovel`/`importNovelsJson` directly).
Concurrent writers lose updates — whichever saves second clobbers the
first's `pendingMutations`.

**Fix.** Single-writer pattern:

- New background message types: `novel-tracker:library-upsert`,
  `:library-update`, `:library-delete`, `:library-import`, `:export-json`,
  `:get-novels`. Popup/options become thin message clients; no direct state
  writes outside the service worker.
- Serialize all mutating handlers (auto-progress included) through one
  promise chain so even background-internal concurrency is ordered.
- Reads stay cheap but also route via `:get-novels` so previews observe a
  consistent snapshot.

**Files:** `src/background.js`, `src/popup.js`, `src/options.js`.

### 1.2 Bounded appliedMutations — client AND server (scoped redesign)

**Problem (original plan was unsafe; see review).** Two distinct growth
issues with different blast radius:

- `state.appliedMutations` grows forever on both sides. Critically,
  `sync-client.js:12` adopts `{...result.state}` on every push — the server's
  blob replaces the client's — and the server persists that same blob into
  `sync_states.state` JSONB, rewriting it on every batch (`index.js:194`).
  The server side dominates.
- Server-side `appliedMutations` is **entirely redundant**: durable dedup is
  already `sync_mutation_receipts` (`index.js:158-168`).

**Why naive history-capping was rejected (deferred).**
`applyCheckpoint` dedups solely on `novel.chapterHistory[event.id]`; pruning
`appliedMutations` removes the other replay guard. Capping history would make
every full pull resurrect evicted events → re-evict → storage churn, and
"evict by HLC" does not converge across devices (A evicts 50 events, B still
holds them, A re-imports them). Safe capping requires a replicated per-novel
`historyFloor` clock (floor = evicted event's readAt; drop replays with
`readAt <= floor`) — design-first backlog item, not this round.

**Fix (this round).**

- Client: cap `appliedMutations` at ~5,000 entries in `applyMutation`
  (insertion-order eviction). Safe *because* chapter history stays uncapped:
  replayed checkpoints still dedupe structurally by `event.id`, patches lose
  LWW, delete/restore are generation-guarded.
- Server: stop persisting `appliedMutations` — strip it from state before
  `UPDATE sync_states` (`index.js:194`). Intra-batch duplicates already hit
  the receipt check before `applyMutation`; cross-request replays hit
  receipts too. Cursor-based pulls never re-deliver, and the cursor-reset
  path (`prepareSyncForAccount`) is structurally idempotent for the same
  reason as above.
- Explicit coupling note: do NOT add history capping until `historyFloor`
  exists — it is what keeps replay idempotence intact once `event.id` dedup
  keys can disappear.

**Files:** `src/lib/sync-core.js`, `server/index.js`,
`tests/sync-core.test.mjs`.

### 1.3 Token-refresh single-flight + skew leeway

**Problem.** `getAccessToken()` (`src/lib/auth.js:225`) has no mutex;
concurrent expiry triggers parallel refresh exchanges (forced sign-out under
rotation). Note: a 30s margin is already baked into `expiresAt` at record
time (`auth.js:106`), but the freshness check itself has no explicit skew
constant.

**Fix.** Single-flight promise guard around refresh; explicit
`TOKEN_EXPIRY_SKEW_MS = 30_000` in the freshness check (net ~60s margin).

**Files:** `src/lib/auth.js`, `tests/auth.test.mjs` (exactly-one-exchange
test).

### 1.4 localStorage fallback drops keys

**Problem.** `set(value)` in the non-extension fallback
(`src/lib/storage.js:30-34`) persists only `Object.keys(value)[0]`;
`saveSyncState` writes two keys → silent data loss in any host using the
fallback.

**Fix.** Iterate `Object.entries`. Test asserting both keys round-trip.

### 1.5 Unify duplicate detection (all three tiers)

**Problem.** Popup preview (`popup.js:170`) uses its own two-rule matcher;
the save path uses a three-tier chain: `matchesNovelIdentity` (exact),
`isLikelyChapterPage` gate, then fuzzy `matchesSavedChapterPattern`
(`storage.js:321-394`). Popup says "New novel detected", save merges anyway.

**Fix.** Export `findExistingNovelForSave` from `storage.js` and use it in
the popup preview directly (not a thin wrapper — the third tier has no popup
equivalent today).

### 1.6 Chapter-history ordering = delete the label sort

**Problem.** `materializeNovel` already sorts history ascending by HLC clock
then id (`sync-core.js:222-232`). `getHistoryEntries`
(`src/options.js:264`) throws that away and re-sorts by label
("Chapter 10" before "Chapter 9"). Sorting a reading log by label was the
bug; a natural-sort comparator is not the fix.

**Fix.** `[...history].reverse()` — newest-first from the materialized
order. (Optional later nicety: `Intl.Collator(undefined,{numeric:true})` if
labels ever need sorting.)

### 1.7 Poison-pill mutations wedge sync forever (NEW — live bug)

**Problem.** The server's validation loop `continue`s on an invalid mutation
**without acking it** (`index.js:147-154`). The client removes only
acknowledged IDs from `pendingMutations` (`sync-client.js:59`) → the invalid
mutation is re-pushed on every sync, forever, silently. Any schema drift
permanently bricks a user's sync. This also constrains 2.4: per-item size
rejection must land here as an explicit rejection, not another silent skip.

**Fix.**

- Server: collect `{mutationId, reason}` into `rejectedMutations` for each
  structurally invalid item; return them in the response. Do **not** insert
  receipts (no fake success); rejection is the client's signal to drop.
- Envelope-level errors (non-array body, oversized batch) remain whole-batch
  400/413 as today.
- Client (`sync-client.push`): filter rejected IDs out of `pendingMutations`;
  surface count/reasons upward. `synchronize()` records a warning in sync
  meta (e.g. `"3 changes rejected: …"`) shown by options UI without failing
  the sync.

**Files:** `server/index.js`, `src/lib/sync-client.js`,
`src/lib/sync-service.js`, `src/options.js`, tests for both sides.

---

## Phase 2 — Server robustness (`server/index.js`)

### 2.1 Indexes: only `(subject, sequence)`

Add `CREATE INDEX IF NOT EXISTS idx_sync_mutations_subject_sequence ON
sync_mutations (subject, sequence);`. **Dropped:** the proposed expression
index on `mutation->>'novelId'` — it serves one once-a-day cleanup query
while taxing the hottest write path; net negative at this scale.

### 2.2 Graceful shutdown

SIGTERM/SIGINT → `app.close()` (drain) → close pg pool (Fastify `onClose`),
with unref'd force-exit timeout. Docker redeploys stop cutting in-flight
batches.

### 2.3 Chunked tombstone purge — keyset pagination + advisory lock

Two corrections to the original proposal:

- `ORDER BY updated_at LIMIT 100` + "loop until done" livelocks: subjects
  without expired tombstones never bump `updated_at`, so the same rows
  return forever. Use keyset pagination on subject:
  `WHERE subject > $1 ORDER BY subject LIMIT $2`.
- "Preserve existing locking semantics" was factually wrong — the purge
  takes no advisory lock today (only row `FOR UPDATE`), while the mutation
  path takes `pg_advisory_xact_lock(hashtext(subject))` (`index.js:112`).
  Each chunk's transaction must **add** the per-subject advisory lock to stop
  racing concurrent pushes.

### 2.4 bodyLimit vs batch size

Raise `bodyLimit` to 4MB (500 × worst-case payload headroom). Individual
oversized payloads (>32KB serialized) become **rejected-with-reason via
1.7's channel** — explicitly not a silent `continue`, which would recreate
the poison pill inside validation.

### 2.6 Push response slimming (NEW)

`POST /v1/sync/mutations` returns the entire canonical state blob
(`index.js:198`) on every call — the dominant scaling cost once state stops
being bounded (see 1.2), larger than the 2.1 index.

**Fix.** Omit `state` when the batch applied zero novel-affecting mutations
(all duplicates / purged-skips / rejects — the steady-state case).
`adoptCanonicalState` (`sync-client.js:4`) already falls back to
`applyMutationBatch(localState, [])` when `result.state` is absent, so the
client needs no protocol change; verify generation-refresh behavior for the
un-acked-pending path remains correct.

### 2.5 Document operational limits

Rate limiting is a per-process in-memory Map — valid single-container,
invalid horizontal scale-out. Documented in `docs/operations.md`; no code
change.

---

## Phase 3 — Permission/privacy hygiene + tooling

### 3.1 Drop the `tabs` permission

Only usage is `tabs.query({active,currentWindow})` in the popup
(`popup.js:104`); `activeTab` covers it post-invocation. E2E risk is lower
than originally flagged — spec URLs are royalroad.com, covered by
host_permissions regardless. Add a **negative assertion** to
`tests/manifest.test.mjs` (existing test only checks positive permissions)
so `tabs` can't silently return.

### 3.2 ESLint + Prettier scaffolding

Flat ESLint config (correctness rules only, no style rules initially),
`.prettierrc`, `npm run lint` wired as its own step in both workflows
(verified safe: both invoke `npm test` at pr.yml:30 / release.yml:37, so a
lint script added there runs everywhere). No mass reformat commit yet; the
misindented block at `auth.js:149-179` gets fixed inline during 1.3.

### 3.3 Docs refresh

Rewrite README repository-layout section (stale since the sync/auth/stats
modules landed); extend the manual release checklist with sign-in/out and
account-deletion steps. ~~Remove report.xml/.DS_Store~~ — review confirmed
both are already gitignored and untracked; nothing to do.

---

## Phase 4 — New features

### Quick wins

| Feature | Design |
|---|---|
| **Trash / undo UI** | `restoreNovel()` exists (`storage.js:605`, verified) with 30-day tombstone retention but zero UI. "Recently deleted" section + Restore buttons + undo toast (~7s) after delete. |
| **Dark mode** | `prefers-color-scheme` variables + manual toggle persisted as `novel-tracker:theme`, applied via `data-theme`. |
| **Keyboard shortcut + context menu** | Manifest `commands` + context-menu save routed through 1.1's single-writer path. Caveats: needs the new `contextMenus` permission (weigh against 3.1's minimization — still far cheaper than `tabs`); commands/contextMenus are unavailable on Safari iOS, so feature-detect and degrade to popup-only there. |
| **CSV export** | RFC 4180 quoting helper + test; columns title/sourceSite/homeUrl/chapterUrl/chapterLabel/status/rating/tags/notes/updatedAt. |

### Medium-term backlog

1. Chapter-update checker via the existing 15-min alarm (badge + optional
   notification; kill switch).
2. Reading heatmap/chart extending tested `computeReadingStats()`.
3. Import adapters (Goodreads / NovelUpdates CSV).
4. Per-site auto-tracking toggle.

### Deferred (design-first — out of scope this round)

- **Per-novel history capping**: requires replicated `historyFloor` clock
  (see 1.2); unsafe as originally specced.
- **Parser conformance fixture harness.**
- **i18n scaffolding.**
- **E2E-encrypted sync**: conflicts with server-side field-LWW merge;
  needs envelope protocol design first.

---

## Verification strategy

- Unit regression test per fix (race simulation, fallback persistence,
  single-flight, poison-pill rejection filtering, appliedMutations bounds,
  manifest negative assertion). `npm test` green throughout (baseline 58).
- Build matrix after manifest changes: `build`, `build:firefox`,
  `build:safari`.
- E2E local stack specs (`sync-flow`, `merge-conflict`,
  `account-deletion`) after 1.1/1.7/Phase 2 land.
- PR workflow green including new lint step.

## Execution order (review-adjusted)

1.4 → 1.6 → 1.3 → 1.7 → 1.2(scoped) → 2.1 → 2.2 → 2.3 → 2.4 → 2.6 →
1.1 → 1.5 (deliberately **with/after** 1.1 so popup matching moves once, not
twice) → 3.1 → 3.2 → 3.3 → quick-win features as follow-ups.
Commit per fix with its test.
