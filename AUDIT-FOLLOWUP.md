> Release-policy update: see RELEASE-1.3.13.md and desktop/SIGNED-RELEASES.md.
> GitHub auto-updates are retained; prior manual-only TJ-18 text below is historical and superseded.

# Audit follow-up: import decisions, asset fencing, free desktop builds

This document supersedes the earlier TJ-04/TJ-05/TJ-18 limitations in
`AUDIT-FIX-PLAN.md`. Source changes only: no production rules, data or release
were changed. Do not roll out the new client without the matching source rules.

## TJ-04: no guessed identity without provider IDs

Stable provider IDs remain authoritative. Changed snapshots containing any
anonymous rows (including mixed anonymous/identified transitions) are quarantined,
not appended, collapsed or used to update the active cloud snapshot. Exact
repetition preserves identical execution multiplicity. Changed time, price, volume,
profit/fees or multiplicity requires explicit choice, not fingerprint guessing.

The real Accounts UI shows both snapshots as JSON, retains a pending local copy,
and requires export + explicit confirmation before accepting the incoming anonymous
set. Matching provider IDs are updated, other provider IDs retained. Choosing to
keep saved history performs no cloud write. Accepting writes an immutable owner-
scoped `accountHistoryBackups` archive and active history in one transaction.
Cloud history signature comparison rejects stale decisions; the UI refreshes the
conflict and requires a new export/confirmation. `historyRevision` increments in
repository rules reject legacy non-concurrent writers. Failed server reads cannot
be treated as an empty baseline. Auth/account switching cancels stale UI writes.

Limits: identity is not magically recovered; the user must compare data. Incoming
feeds may be incomplete: replacing the anonymous set is a deliberate, warned
operation with both versions archived. Firestore's document size/transaction
limits still apply: oversized archival fails atomically, never truncates history.
If local storage is unavailable the warning requires exporting before closing;
no browser can guarantee durability after total local-storage/process failure.
Previously lost/collapsed data needs a provider export or earlier backup.

## TJ-05: a server-enforced fence before the query

1. Transactionally lock `journalAssetGuards/{uid}` and store operation ID/plan.
2. Only after acknowledged lock, run the server trade query. Repository rules
   fence all journal trade/image mutations (including old clients/admin writes)
   and asset metadata changes while locked; unrelated title fields remain usable.
3. Final transaction verifies operation and every selected trade, writes all
   affected trades/images/settings and unlocks with an irreversible retired-name
   tombstone and idempotency receipt. `assetRevision` protects metadata against
   legacy stale writers. Concurrent retry shares the same plan/receipt.
4. Failure cancels only its own still-active lock. If disconnected cancellation
   cannot commit, the fence remains: reconnect and retry the ORIGINAL operation
   shown in the error. A crash-resume does not use a time-based unsafe expiry.

Writes before the lock are included in the strong query; writes during the lock
are denied; late/offline writes to the old name are denied after finalization.
No new background service or privileged backend is assumed.

Bounded by design: >450 matching trades or >490 planned writes is refused with
no partial migration. At most 500 retired names; retired names cannot be reused.
For larger/long-lived journals a separately designed scalable migration protocol
is still needed. A leftover fence temporarily blocks journal editing, not reading;
retry the original rename/delete rather than manually deleting guard documents.
Rules cannot constrain privileged Admin SDK/security-rules-disabled maintenance;
such external writers must be separately coordinated. User/admin direct intentional
edits to their authorized data are not an adversarial integrity boundary.

## Coordinated rollout / compatibility

New `journalAssetGuards`, `accountHistoryBackups`, `assetRevision` and
`historyRevision` are additive. Existing data is read without rewriting it merely
for migration. Old metadata/history writers that omit new revisions will receive
permission-denied under the new rules; force a client reload/update and explain
this rather than permitting stale overwrites. Existing unrelated Notes/settings
writes retain their old formats. Deploy client and rules only under separate
production approval, preserving local drafts and accounting for cached clients.
Testing source rules is not deploying them.

## TJ-18: free build is manual, not fake-authenticated auto-update

See `desktop/SIGNED-RELEASES.md`. Default requires no paid certificate/new secrets,
builds a manual-only application and publishes no automatic updater feed. Runtime
stops before constructing updater controllers/timers/download/install. Signature
verification stays enabled for the optional real Authenticode mode. The packaged
policy gate checks actual app.asar metadata, not merely source configuration.
A compromised release token is NOT solved by checksums from the same channel.

Already installed v1.3.12 is not changed. First transition requires a separately
approved new release and manually verified installer; there is no automatic
unsigned bridge. Windows native build/signature/SmartScreen and installed migration
remain Windows-specific checks, not asserted by Linux/VM tests.

## Reproducible verification (isolated dependencies, never production)

```sh
NODE_PATH=/tmp/tj-browser/node_modules CHROME_PATH=/usr/bin/chromium \
  node --test tests/*.test.cjs public/tests/*.test.cjs desktop/tests/*.test.cjs
# Existing seven scenarios plus real DOM conflict/notes/security regressions:
NODE_PATH=/tmp/tj-browser/node_modules CHROME_PATH=/usr/bin/chromium \
  node public/tests/audit-remediation.browser.cjs
NODE_PATH=/tmp/tj-rules/node_modules \
  /tmp/tj-rules/node_modules/.bin/firebase emulators:exec --only firestore \
  --project demo-tradingjournal-audit --config firebase.audit.json \
  'node --test --test-concurrency=1 verification/*.rules.test.cjs'
```

`asset-fence.rules.test.cjs` executes the actual AST-extracted client algorithms
with the real Firebase SDK and loopback Firestore/rules engine; adapters only map
compat calls and re-home VM plain containers. Hooks schedule real competing writes,
not mocked successful transactions. Tests include before/during/after lock writes,
real offline SDK queue, retry/crash/failure, foreign UID, retired tombstone,
oversized trades/images, atomic archive rejection, stale decisions/revisions and
auth switching. Browser tests use real DOM with a local database double and block
external network. Build-policy tests inspect the actual entrypoint with a mocked
builder and temporary fixture files; they are NOT a Windows EXE build.
