# Journal stability audit: fixes and rollout gates

Base: `main` at `a9f0f1f2393f8644ad02d03268e3745b9ce57b0d`.

This change set fixes the confirmed audit defects without changing the Firebase rules, deploying the site, publishing a desktop release, or changing Replay execution semantics. It is not a guarantee that no other defects exist.

## Confirmed defects addressed

| Audit | Change | Regression coverage |
| --- | --- | --- |
| F01: stored markup / unsafe image URLs in journal views | Escape attribute values; restrict screenshot URL schemes and data-image types; use Firestore document IDs as record identity. Trade, gallery/calendar, diary and backtest paths are covered. | VM security assertions and real DOM payload tests at mobile/desktop widths. |
| F02: offline Backtest/Replay writes replaced by a successful cloud read | Add an owner/auth-bound durable operation outbox. Persist complete intents before optimistic new-record/delete UI changes, replay acknowledged chunks, and overlay pending/read-time intents before replacing caches. Preserve record object identity. | Offline/reload, patch ordering, owner binding, quota failure, acknowledged-read races and replay bridge tests. |
| F03: stale Notes index/page writes overwrite another device | Guard all page/index changes with one root-revision Firestore transaction. Keep conflicts local, offer JSON export and explicit cloud reload, and retain conflict/baseline information in both local caches. Share publishing follows acknowledgement. | Atomic success/conflict tests, empty-index and clock-skew regressions, real DOM conflict/reload tests. |
| F04: deleted journal records resurrected from IndexedDB | Empty cloud results no longer trigger automatic legacy uploads. Offer a local JSON recovery export instead. | Empty-cloud/legacy cache test confirms no import writes. |
| F05: late failed deletion restores records into another selected owner | Capture owner/generation; do not roll back durable queued deletes into a newly selected workspace. | Delayed rejection after owner switch. |
| F06: partial large deletes roll back already-deleted records | Persist the entire multi-chunk intent before starting; keep acknowledged progress and resume remaining chunks. Delete parent last. No fictitious full rollback. | More than 450 writes, injected middle-chunk failure and retry. |
| F07: private chart images orphaned on deletion | Group image and record deletes; include private image references in backtest deletion intents and asset-trade transactions. | Image/record atomicity and asset isolation tests. |
| F08: debounced curve setting saved for the wrong owner | Capture owner, payload and generation before the debounce; ignore stale completions. | Owner switch during debounce and chart callback tests. |
| F09: cached Backtest trade loader resolves to undefined | Resolve the actual trade array on the cached path. | Promise return-value regression. |
| F10: failed usage write loses elapsed time | Persist independent UID-scoped elapsed-time records before awaiting writes; retain failed records and serialize drains using Web Locks where available. | Failure/retry, overlapping flushes, browser reload, separate UIDs and two-tab drain tests. |

Additional confirmed defects fixed during regression work:

- Backtest edit resolved a synthetic/filtered chart row instead of the persisted record and could create a duplicate. Both editor and submission now resolve authoritative identity; a missing edited record is an error, not a new trade.
- Notes conflict handling could persist the older in-flight snapshot after the user typed more. It now persists the current draft; a dedicated deferred-transaction test covers this race.
- Decorative Notes database icons are hidden from accessibility names. Browser tests select actual labels rather than relying on fallback icon text.

## Accounts proxy hardening (both providers)

- Encrypted connection tokens are version 2, UID-bound, generation-bound and limited to 30 days, with a future-time sanity check. Old version 1 tokens require reconnection.
- Disconnect rotates server-only Firestore revocation state; a copied pre-disconnect token is rejected on subsequent requests. The client clears a connection only after `revoked: true`, not after an ignored server error.
- All upstream fetches share a 25-second request budget. History, open trades and daily data are fetched concurrently and retain explicit partial-error reporting.
- Vercel helpers live under root `lib/`, not `api/`, so helper files do not become API endpoints. Netlify helpers live under `netlify/functions/lib/`.

### Required before deployment

1. Configure **`FIREBASE_SERVICE_ACCOUNT`** as a secret in the selected proxy hosting environment: full service-account JSON for the expected Firebase project (default `retocker`; optional `FIREBASE_PROJECT_ID`). The account needs server-side Firestore data access via IAM. A hosting-only deploy credential or an existing GitHub secret is not proof that this is configured in Vercel/Netlify. Never commit this secret or put it into browser code.
2. Preserve existing proxy configuration (`FIREBASE_WEB_API_KEY`, encryption/root secret and origin settings). The new service-account secret is additional, not a replacement.
3. Deploy/configure and verify the proxy **before** releasing the new browser client. Revocation fails closed with a readable error when configuration/state access is unavailable. The old proxy cannot truthfully acknowledge the new disconnect contract.
4. In staging with real services: connect, load each account/report, inject upstream failures, disconnect, then verify a copied old token is rejected; reconnect an existing version 1 client.
5. Invalidate updated client asset URLs and test a two-device Notes conflict with both clients updated. An old cached client that does not implement the revision protocol is outside its concurrency protection.
6. Run native Windows/Electron smoke tests (startup, resize, close/reopen, offline queue, account/owner switch and update lifecycle) before any desktop release.

No real credentials were used for these tests. No live proxy environment, Firestore rules emulator, live Myfxbook integration, or native Windows runtime was validated in this workspace.

## Retained policies / recovery behavior

- Firebase rules are unchanged. Exact-link public Notes images/shares and the existing public movie-tracker document remain existing product policies, not newly tightened permissions.
- Replay still uses its existing OHLC assumptions: SL-first if SL and TP touch in one candle; entry candle uses its full range. The UI now says so explicitly. Intrabar precision was not invented.
- Old pre-outbox backtest caches are preserved in an owner-scoped recovery snapshot before reconciliation, not silently reuploaded: an old cache alone cannot distinguish an unsynced record from an intentionally deleted cloud record.
- The legacy journal recovery action exports JSON; it does not automatically restore cloud data.
- The outbox uses idempotent set/delete retries. Usage increments do not claim exactly-once delivery across an ambiguous remote acknowledgement followed by a browser crash. Cross-tab pumps use Web Locks where supported; unsupported environments need additional manual coverage.
- Notes transactions are guarded to stay within their page-operation limit; oversized/too-many-page cases remain explicit errors with a local draft, not partial migrations.

## Verification

Local runtime: Node 24, sandbox Chromium, Playwright 1.63.0. Network access to production services is blocked/stubbed in browser regression fixtures.

```sh
export CHROME_PATH=/path/to/chromium
export NODE_PATH=/path/to/installed/playwright/node_modules
node --test tests/*.test.cjs public/tests/*.test.cjs desktop/tests/*.test.cjs
for scenario in models-recovery notes-empty notes-admin-status notes-share usage-stats notes-database stabilization; do
  node "public/tests/$scenario.browser.cjs"
done
```

- Final combined suite: **261 tests passed, 0 failed**.
- Seven additional browser scripts passed: recovery, empty Notes, admin Notes status, shared Notes, usage stats, Notes database interactions and security/conflict persistence. Widths vary by script (320/390/1440); not every scenario runs at every width.
- The final Notes conflict change was followed by another full combined suite and security/conflict browser run.
- `git diff --check`, production JavaScript syntax checks, and the root/public Notes mirror comparison passed.
- The new pull-request CI workflow repeats these checks on Node 22. Its remote outcome must be checked separately; local success is not a claim of successful GitHub CI or live-service compatibility.

Stale test fixtures were updated to model atomic transaction behavior, current Firebase auth identity, current view structure and accessible labels. Regression assertions were added for the defects rather than disabling the affected production paths.
