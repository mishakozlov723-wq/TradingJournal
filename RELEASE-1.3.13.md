# Release 1.3.13 — rollout checklist (not a publication claim)

## Required behavior

GitHub auto-updates retained, no mandatory paid Authenticode. The earlier manual-
only audit change was NOT released and is superseded. TJ-18 is reclassified as
GitHub publisher/account supply-chain trust rather than a proven unsigned-update
exploit. TLS/GitHub provider, SHA512 download checks and user download/restart
consent remain; checksums are not independent signatures. Optional real signing
still verifies publisher and fails closed when requested but unavailable.

Version package/lock: 1.3.13; repo mishakozlov723-wq/syter-releases. Feed latest.yml,
SYTER-Setup-1.3.13.exe/blockmap + SYTER-Install-1.3.13.exe/manifest. Full Windows CI
validates actual packaged mode/feed, artifacts and installer. Additional real
1.3.12->1.3.13 migration uses public old installer pinned by its actual GitHub
asset digest, a disposable Windows profile and a temporary loopback feed; old
app updater code is not modified, normal GitHub config is restored by new install.
This tests native install handoff, NOT a public GitHub-delivery claim before release.

## Gates before merge/publication

1. Read current PR/main/tags/releases/jobs; preserve all other authors' work.
2. Full readonly Linux regression + real rules emulator + complete Windows CI,
   publish=false on PR branch. No reduced notes/installer/check-only bypass.
3. Read-only production preflight using existing protected Firebase credential:
   save current ruleset/release and Hosting release as rollback artifact. Compare
   actual rules with audited main baseline. Missing permission or different live
   rules is a BLOCKER pending review; never blindly overwrite live configuration.
4. Review actual compatibility: legacy ordinary trade/image/Notes writes allowed;
   legacy asset/history writes allowed until per-owner/per-record adoption. Once
   adopted, stale unversioned writes fail explicitly rather than losing data.
   New frontend is served to old v1.3.12 shell on reload (same app URL/appId).
5. Merge only green reviewed commit through ordinary GitHub controls, no bypass.

## Production rollout order

- Preserve rollback references BEFORE changes. Deploy compatible source rules
  first, then Hosting of the same verified main commit. No data migration,
  deletion, credential rotation or real-account tests.
- New protocol is not activated by deployment alone: asset fence/tombstones and
  per-document revisions appear only when a user intentionally performs the
  corresponding operation. Unadopted old clients remain compatible; adopted stale
  editors must reload before metadata/history changes. Ordinary notes/trades and
  existing public links remain unaffected except invalid enum writes are denied.
- Smoke-check live HTML/JS hash/version bytes and active ruleset source; no login
  or writes to user data. Hosting deploy-only is insufficient for these fixes.
- Only after successful compatible web+rules rollout publish desktop 1.3.13 with
  complete verified feed/assets through the main-only full-gated workflow.
- Read back published release/assets/feed, compute all digests and verify workflow
  status. Do not silently overwrite public assets/tag. Old 1.3.12 discovers the
  new GitHub stable version through its existing mechanism; manual installer is
  fallback only. Actual installed upgrade and public-delivery proof are distinct.

## Rollback design and hard boundaries

If rollout fails before activation, restore previous Hosting release and Firestore
release ruleset captured by preflight. Do not modify any user data. After users
start a new asset/history protocol, reverting to legacy rules would remove fences
and permit stale overwrites: do NOT blindly roll back enforcement. Keep the new
rules and repair/roll forward the frontend, or pause affected UI while retaining
all drafts/tombstones/archives. Interrupted operation is resumed by original ID,
not by deleting guard documents. Published desktop version is immutable; any
post-publication repair is a new version, not altered v1.3.13 assets.

Current constraints remain explicit: bounded asset operation450trades/490writes,
500retirednames and no reuse; anonymous imports require user decision/archive;
huge archives fail without truncation; previously lost data needs backups.
Certificates are not purchased/generated; secrets stay in protected Actions.

## Durable private CI export (Actions quota independent)

Verified build files and rollback snapshots are stored in DRAFT releases of the
PRIVATE source repository TradingJournal, tags ci-windows-RUN-ATTEMPT or
ci-rollback-RUN-ATTEMPT. This is software build storage, not the public updater
repository syter-releases and not v1.3.13 publication. Existing GITHUB_TOKEN is
scoped contents:write only to required jobs; no new credential, purchase or
public release is needed. The exporter checks exact private repository, source
SHA, draft identity, complete rollback snapshot/no credential keys, then uploads
and downloads every file and verifies its SHA256 byte-for-byte. An immutable
verified-export.json receipt is saved last. Errors block the job; no clobber,
delete or publish API exists in this exporter. Unrecognized/public releases or
mismatched resumed assets fail closed. Existing optional PNG Actions exports
may fail on quota; actual tests and final private installer/rollback export do
not continue on failure. Normal public publication still requires main and all
full Windows gates, after compatible production rollout. Previously published
v1.3.12 and all pinned historical baseline artifacts remain unchanged.

Private storage draft metadata anchors to existing `main` rather than creating a feature-SHA tag (which can require workflows-write). Exact tested source SHA is in the draft body and byte-verified receipt; no workflow-write permission is granted and these drafts are never published.

Final TJ-05 review additionally reproduced two legacy admin clients racing an old uidless root: lock checks must resolve the incoming owner UID, not the administrator UID. Rules now fence both existing and incoming owner for asset metadata. A real SDK/emulator regression fails on prior rules and passes with the fix; full local rules suite23/23. No production data was accessed by this test.

## Readback recovery after the first live deployment

Production workflow40143606893 at sourcea7612c4b4358f4042683cfd118ab448e9eb99596 saved a durable private rollback snapshot before activating rules and deploying Hosting version1b8c85f549cd252f. Both writes succeeded, but the first CDN HTML read one second later differed, so the release remained blocked. Independent subsequent GETs matched all five source files exactly. The bounded verifier now repeats only GETs on transient mismatch; it still requires every exact byte and fails after its finite bound. `verify_live_only=true` verifies existing main rules/frontend with read-only job permissions and no redeployment, backup overwrite or user-data write. Unknown active rules remain a hard error. This mode does not claim a new Hosting deployment and does not publish desktop assets.
