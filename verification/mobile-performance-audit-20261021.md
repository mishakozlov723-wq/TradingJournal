# iPhone website cold-loading audit (2026-10-21)

Inspected baseline: `f26f062a9399909c08df32dc50b6befe5540945f`. Scope: website only, after Sign in and first/cold Notes opening. The user reports that reopening Notes is fast, but the first opening after login or long inactivity is slow. Reported durations are estimates, not measurements. A stale-cache explanation is a hypothesis, not an established cause.

## Design constraint and correction

“Your Notes Space” is an intentional part of the design. Its visuals, mobile/desktop behavior, 900 ms initial hold, 4200 ms minimum intro, animation-completion gate and 220 ms exit are fully preserved. The earlier commit's mobile intro bypass has been reverted in this branch; tests and PR scope now explicitly protect the original schedule. No animation removal is part of the optimization.

The entire `notesLoadingRun` / `notesTransition` / `notesLoadingTransition` / `enterNotesWorkspace` section was compared with the baseline and is exactly identical. No CSS, animation, access-rule or cloud-loading lifecycle change remains.

## Retained production change

`notesSaveLocal` previously stringified the full mobile Notes snapshot for localStorage after `notesMobileCachePut` had already stringified and parsed it for IndexedDB. A synthetic VM probe confirmed two full stringifications for a single local save.

The patch reuses that JSON for localStorage, while preserving the detached IndexedDB snapshot, immediate durable local write, quota reporting, owner-scoped keys and revision/conflict fields. It also avoids duplicate encoding on final mobile load reconciliation. It does not change the storage format, cache expiry, server reads or persistence debounce. Root `notes.js` and served `public/notes-workspace.js` remain identical; the served resource fingerprint is updated.

This is a small CPU/allocation optimization, NOT a claim to have fixed the 15–30-second cold-loading symptom. No iPhone end-to-end speedup has been measured.

## Confirmed cold-loading lifecycle (baseline paths)

- `public/app.js:7548–7602`: Sign in awaits the user directory and usage initialization before entering the app. `startUsageTracking` (`7092–7148`) includes a server read and transaction and refreshes usage stats. Root initialization/ownership guarantees must not simply be removed.
- `public/app.js:1580–1660`: `loadData` reads settings/models, then trades, then waits for `loadBacktests`. Both backtest server collections (`1866–1911`) therefore gate removal of the Overview skeleton (`7592`). Safely separating this requires explicit Backtests/Replay loading/error states and owner/outbox regression coverage.
- `tjLoadUserDirectory` shares an in-flight promise for the same UID; `startUsageTracking` also guards a started tracker. The auth-state callback and sign-in callback calling these helpers is not by itself proof of duplicated full requests.
- `public/app.js:1484–1564`: live subscriptions follow initial reads. Initial snapshots can repeat CPU reconciliation, but SDK caching/stream reuse means this is not proof of another billable full download.
- `notesLoad(false)` immediately returns when `notesLoadedFor` already matches the owner, so a warm reopening can avoid root/page refetching. That is consistent with, but does not prove the cause of, the user's warm/cold difference. A reload starts a new in-memory lifetime.
- On a cold load, localStorage can supply a preview, and IndexedDB is raced against a 180 ms fallback. IndexedDB snapshots older than seven days are rejected. This 180 ms race is not evidence of a 15–30-second cache wait; actual cache presence/age and synchronous parsing cost have not been measured.
- The Notes root is explicitly fetched from the server; an owner repair, if needed, adds a write and reread. Then all page documents are fetched, with at most four mobile workers. All documents must reconcile before editing is enabled. Missing/inaccessible pages must never be treated as an empty workspace just to remove the spinner.
- `enterNotesWorkspace` starts loading from the original transition callback after the initial 900 ms hold. On mobile it calls reveal immediately and starts `notesLoad(false)` via requestAnimationFrame/setTimeout; the actual read-only loading continues underneath the branded animation. Cached/warm data does not shorten the intended animation.

## Local checks after restoring the animation

- Targeted suite: **55 passed, 0 failed** (42 preexisting, six snapshot-encoding regressions, seven original-animation lifecycle regressions).
  `node --test tests/chart-resize.test.cjs tests/stabilization.test.cjs tests/notes-local-save-perf.test.cjs tests/notes-loading-transition.test.cjs public/tests/notes-mobile.test.cjs`
- Animation tests cover the same 900/4200/220 ms schedule for mobile and desktop, remaining-time calculation, unfinished animation completion, stale transition callbacks, partial-data protection and absent-overlay fallback. Timers are controlled synthetic fixtures, not a physical-device frame-timing benchmark.
- Existing `mobile-polish.browser.cjs` was rerun after restoration: 24 checks passed at 320/390/600/768 widths, external requests blocked. Its hardcoded Windows Chrome path was temporarily substituted for installed Linux Chromium; the harness change is not committed.
- JavaScript syntax checks for both Notes copies; mirror equality; full transition/entry lifecycle equality with baseline; changed-production-file whitespace checks.
- Full repository suite, remote CI, live Firebase, actual iPhone browser/WebKit, and live CPU/network timings have NOT been validated. No production credentials or private trading/Notes contents were inspected.

## Next investigation, with the animation preserved

1. Record private-content-free phase timings for auth, directory, usage init, settings, trades, both backtest queries, Overview readiness, Notes root/repair, page requests, normalization and cache save. Compare cold/warm loads on the actual iPhone/browser over Wi-Fi and mobile data.
2. Capture only document counts, aggregate byte sizes and cache age/hit status; never record text, image URLs, tokens or trade contents. Do not label stale cache as the cause without evidence.
3. Prioritize removing the dependency between Overview readiness and unrelated backtest reads, with explicit background-loading states and identity guards.
4. Loading Notes data in parallel with the unchanged intro may be investigated. Do not move `notesLoad` earlier blindly: it renders, updates workspace state and can trigger recovery/owner-repair persistence. A safe prefetch would need a read-only phase, current auth/owner/generation guards, no early focus/visible mutations, in-flight deduplication and a guarded handoff to the existing reconciliation lifecycle. No prefetch implementation is included here.
5. Do not enable partial-page editing or relax conflict/access checks to shorten the loading indicator.

No new paid service, native application, merge, deployment or release is part of this work.
