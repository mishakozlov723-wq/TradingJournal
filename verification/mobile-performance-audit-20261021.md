# iPhone website loading audit (2026-10-21)

Inspected baseline: `f26f062a9399909c08df32dc50b6befe5540945f`. Scope: website only, after Sign in and opening Notes. No production account, trading data, secrets, paid service, native build, deployment or merge was used. The iPhone browser/version and live timing trace are not yet available. User estimates of 15–30 seconds are not measured results.

## Confirmed code paths, not a measured attribution

- `public/app.js:7548–7602`: Sign in awaits the user directory and usage initialization before entering the app. `startUsageTracking` (`7092–7148`) includes a server read and transaction; the ordinary initial path also refreshes usage stats. Existing root initialization/ownership guarantees mean this must not simply be removed.
- `public/app.js:1580–1660`: `loadData` reads settings/models, then trades, then waits for `loadBacktests`. Both server-side backtest collections (`1866–1911`) therefore gate the Overview skeleton removal (`7592`), even though Overview displays journal trades. Safely separating this needs explicit loading/error states for Backtests and Replay and owner-switch/outbox regressions; it is intentionally not changed here.
- `public/app.js:1484–1564`: after initial reads, live subscriptions are installed for trades, backtests, backtest trades and settings. Initial snapshots may repeat normalization, cloning and reconciliation. Firestore's SDK may reuse cached/active streams: this is NOT proof that every initial snapshot produces another billable full download.
- `public/notes-workspace.js:1797–1828` at baseline: mobile Notes fetches every page document with at most four workers, not only the visible page. `notesMobileBusy` (`1778–1792`) intentionally prevents editing partial snapshots until the full reconciliation completes. Large page sets, large embedded data and network latency can prolong this gate; actual document counts and sizes are unknown.
- Notes has an artificial 900 ms hold before even starting its transition callback, followed by a 4200 ms minimum branded intro and a 220 ms exit (`2810–2866` at baseline). Mobile calls reveal immediately but still honors this animation schedule; the real read-only page loading runs underneath. These are overlapping waits, so do NOT subtract 5.32 seconds from a live measurement or add this figure blindly to network duration.
- `notesSaveLocal` serializes the full Notes snapshot for localStorage after `notesMobileCachePut` has already serialized and parsed it for IndexedDB. A synthetic VM probe confirmed two stringifications for one production mobile local save. This occurs on final load reconciliation as well as edit saves.

## This small patch

1. Mobile enters Notes immediately, showing the existing real read-only loading state. Desktop intro is unchanged. The full cloud reconciliation, conflict/revision checks and partial-data write protection are unchanged.
2. Reuse the mobile snapshot JSON for localStorage while retaining the detached IndexedDB snapshot. Immediate durable local writes, quota reporting, owner scoping and cloud revision/conflict fields are retained. No storage format or persistence debounce change.
3. Keep root `notes.js` and served `public/notes-workspace.js` identical and update the served asset fingerprint using the existing MD5-prefix convention.

No measured iPhone speedup or resolution of the post-login skeleton issue is claimed.

## Checks run locally

- Baseline targeted suite: 42 passing, 0 failing.
- Patched targeted suite: 53 passing, 0 failing (same 42 plus 11 new regressions).
  `node --test tests/chart-resize.test.cjs tests/stabilization.test.cjs tests/notes-local-save-perf.test.cjs tests/notes-loading-transition.test.cjs public/tests/notes-mobile.test.cjs`
- Existing `mobile-polish.browser.cjs`: 24 checks passed at widths 320, 390, 600 and 768, external requests blocked. Only its hardcoded Windows Chrome path was substituted in a temporary local copy to use installed Linux Chromium; that temporary change is not committed.
- `node --check` for app.js and both Notes copies; Notes mirror equality; changed-file whitespace checks.
- Full repository suite, remote CI, live Firebase, real iPhone/WebKit, and live network/CPU timing have NOT been validated here. Existing historical verification reports are not evidence of this patch's live performance.

## Next zero-new-service-cost investigation

1. Capture timestamps/durations only (no page text, image URLs, tokens or trade contents) for auth completion, directory read, usage init, settings, trade query, each backtest query, first Overview render, Notes root read, owner repair, page-fetch completion, normalization and local cache save.
2. Test cold and warm loads on the actual iPhone/browser over Wi-Fi and mobile data; record number of Notes documents and aggregate bytes, not their private contents.
3. Prioritize decoupling Overview readiness from backtest server reads with owner/generation guards and explicit Backtests/Replay loading states. Do not solve slow reads by treating timeouts or denied reads as empty data.
4. For Notes, consider incremental loading only with a separate completeness/dirty-page persistence protocol. Simply enabling editing after the first four-page batch risks partial workspace overwrites and is not an acceptable optimization.

Needed from the user: browser name/version, iPhone/iOS model/version, approximate Notes page count/attachment usage, whether warm re-entry is equally slow, and whether the stuck indicator is the branded full-screen intro or the inline “Загрузка заметок…” message. No credentials or private trading export needed.
