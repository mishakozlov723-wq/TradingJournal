# iPhone website cold-loading audit (2026-10-21)

Baseline: `f26f062a9399909c08df32dc50b6befe5540945f`. Scope: the website after Sign in and the first Notes opening after login/long inactivity. The user reports that reopening Notes in the same session is normal. The reported 15–30 seconds is an estimate, not an instrumented measurement. Cache staleness remains a hypothesis.

## Non-negotiable design constraint

“Your Notes Space” is intentional. Its visuals and mobile/desktop schedule remain exactly unchanged: 900 ms initial hold, 4200 ms minimum intro, animation-completion gate, and 220 ms exit. No CSS, animation, transition, or early reveal change is included. The transition/entry regression tests continue to protect this behavior.

## Confirmed causes in code

### Overview skeleton unnecessarily waited for Backtests

`loadData` loaded settings, trades, and then both server Backtest collections before the Sign in completion callback hid the Overview skeleton. Backtests were therefore a confirmed dependency of the skeleton even though Overview does not need them.

The patch now resolves the core load after settings/trades and keeps the two Backtest reads in `load.backtestsReady`. Overview renders and removes its skeleton immediately after the core load. Backtests has an explicit non-interactive “Loading backtests…” state; Replay continues to use `backtestsLoadedFlag`. Initial live listeners still start only after `backtestsReady`, preserving the existing reconciliation order.

Owner/generation guards, `tjBacktestLoadGeneration`, owner-scoped local cache/recovery, outbox capture/flush, and both `tjOverlayBacktestOutbox` calls remain in the Backtest loader. A stale load rechecks identity before UI refresh or listener startup. Failed server reads retain local/outbox state and show an explicit refresh warning.

Expected effect: the post-Sign-in Overview skeleton no longer includes the latency of the `backtests` and `backtestTrades` server queries. The actual improvement on the user’s iPhone has not yet been measured.

### Cold Notes performs a server root read followed by all indexed page reads

A warm `notesLoad(false)` returns immediately when the same owner is already loaded. A new in-memory lifetime reads the root from the server and then all page documents. Mobile uses at most four workers and keeps the workspace read-only until the full set is reconciled. This explains the structural cold/warm difference, but does not identify which phase takes 15–30 seconds on the user’s device.

The IndexedDB preview is raced against a 180 ms fallback and snapshots older than seven days are rejected. This is not evidence that cache expiry itself causes the long wait.

### Admin owner repair could compete with the current Notes cold path

Before this patch, `notesLoad` launched `notesRepairKnownOwnerRoots()` immediately. For an admin with multiple known profiles, that function starts one server root read per profile, independently of the currently viewed workspace. The requests were not awaited, but could compete with the current root/page reads.

The patch defers this cross-account maintenance until the current Notes load settles and the browser is idle (or a 1200 ms fallback timer). The current owner’s `notesEnsureCloudOwner` guard remains on the load path, so write authorization/ownership repair is not weakened. The code-level fan-out is confirmed; its contribution on this user’s account is still a hypothesis because role, profile count, and live network timing were not inspected.

## Notes phase diagnostics and separation

The patch adds content-free in-memory diagnostics exposed as `window.TJNotesDiagnostics.latest()` and a `tj:notes-load-diagnostics` event. It records only:

- cold/warm, mobile, force-load, cache hit/miss;
- total time and phase durations for local read, cache read, server root read, owner check, page reads, preparation, UI apply, or orphan recovery query when applicable;
- aggregate counts: local pages, page requests, cloud pages, missing pages, and total serialized page-character count;
- outcome/recovery category.

It does **not** record owner/login/UID, titles, note text, images/URLs, tokens, document IDs, trade data, or Firebase credentials. The last ten summaries exist only in page memory; nothing is uploaded by this instrumentation.

For the normal indexed-root path, page snapshots are now passed through a side-effect-free `notesPrepareCloudPages` phase before any global/UI mutation. Only after the complete set is prepared does the code apply workspace state, render, and—when required—queue local/cloud repair. Missing-page, stale-draft, conflict, owner/generation, partial-editing, and cloud-incomplete protections remain.

This refactor enables real phase measurement and clearer safety boundaries. It is not itself a claim of a 15–30-second speedup. The earlier full-snapshot encoding reuse remains as a small independent CPU/allocation optimization.

## Hypotheses still requiring a real cold trace

- Slow server root read after a long idle connection.
- Many/large page documents making the bounded page-read phase dominant.
- An owner metadata repair adding a write plus root reread for the current workspace.
- Orphan-index recovery query or cloud repair path being entered.
- Synchronous local JSON parse/normalization or render cost on the specific iPhone.
- Browser/network reconnection behavior after long inactivity.

No current evidence justifies increasing Firebase spend, changing access rules, allowing partial editing, removing the animation, or building a native app.

## Verification

- **63 targeted Node tests passed, 0 failed**: 42 pre-existing coverage plus prior snapshot/animation regressions and 8 new cold-load/diagnostic assertions.
- New tests verify that Overview resolves while Backtests remains pending; live listeners wait for guarded Backtest reconciliation; stale identities cannot start listeners; Backtests is non-interactive while loading; outbox/owner/generation guards remain; Notes preparation precedes UI/recovery writes; diagnostics omit content/identity fields; cross-account repair is deferred.
- Existing Notes mobile tests still verify four-request concurrency, early local/IndexedDB preview, owner-switch invalidation, missing-page protection, orphan recovery, stale-revision conflict behavior, and desktop parallel fetch.
- **24 isolated mobile browser checks passed** at widths 320/390/600/768 with outside requests blocked. The Windows executable path was temporarily changed to the installed Linux Chromium path; no harness edit is committed.
- JavaScript syntax checks passed; root/served Notes copies are identical; asset fingerprints were updated.
- The original Notes transition/entry lifecycle remains covered by 7 exact timer/guard regressions.

Not validated: a live Firebase cold trace, actual iPhone/browser timings, remote CI, full repository suite, merge, deploy, or release. No credentials, private notes, attachments, or trading records were inspected.

## Next measurement requested

On the affected iPhone/browser, reproduce one first Notes opening after a long idle period and then one immediate reopening. Read only `window.TJNotesDiagnostics.latest()` (or capture the event summary). The phase summary—not note contents—will show whether root, page reads, preparation, render, repair, or cache behavior dominates. Browser name/version, iPhone model/iOS, approximate page count, and whether Notes includes many images would complete the comparison.
