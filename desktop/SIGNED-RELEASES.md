# Desktop update trust: free manual builds and optional Authenticode

## Free default (no certificate or new secrets needed)

`npm run build` defaults to `SYTER_SIGNED_RELEASE=false`. It embeds
`syterUpdatePolicy: manual` in the installed application, permits unsigned NSIS
and native-wrapper compilation, and **does not instantiate the update controller,
check/download a feed, or install on exit**. Signature checking is not disabled.
The tray item **Обновления и безопасность** explains the limitation and can open
only the fixed release webpage. It never downloads or executes an installer.
Windows/SmartScreen may warn about an unknown publisher. The web journal still
loads its normal HTTPS deployment; this policy concerns desktop EXE updates.

Manual release dispatch uses `signed_release=false`. Full verification gates
remain mandatory for publication. Only the native manual installer and manifest
are published: **no latest.yml, Setup EXE or blockmap updater feed**, and the release
is not marked latest. Drafts containing unexpected/mixed-mode assets are refused.
A checksum/manifest from the same channel is useful for corruption detection,
**not independent proof against a compromised release account/token**. Users must
make a manual trust decision and verify the source/independent information; the
application does not claim an unsigned installer is cryptographically authenticated.
No dummy/self-signed trust key is generated and no security dialogs are bypassed.

## Optional trusted Authenticode mode

Set `SYTER_SIGNED_RELEASE=true` (`signed_release=true` in workflow) and configure
protected `SYTER_CSC_LINK`, `SYTER_CSC_KEY_PASSWORD`, and exact
`SYTER_PUBLISHER_NAME`. Partial/missing signing configuration is a hard error,
not an unsigned fallback. Both NSIS and native-wrapper EXE must have valid chain,
expected publisher and timestamp. Installed policy is `authenticode`; updater
also requires publisherName anchored in the installed configuration and enabled
signature verification. Never learn publisher identity from downloaded metadata.
There is currently **no separate pinned-key update-signature mechanism**. Paid/public
Windows publisher trust and an independently signed custom update protocol are
not interchangeable; implementing the latter requires an explicit key lifecycle,
rotation/revocation and independently reviewed verifier. This change chooses the
safe free alternative: no automatic desktop updates.

## Existing v1.3.12 migration — not repaired remotely

The already published/installed updater remains old code. Repository changes do
not patch it. Do not publish unsigned automatic-update metadata to bridge it.
Choose a NEW version under separate release approval, distribute a manually
reviewed installer through an independently verified communication channel, ask
the user to quit the old application and install manually. Preserve userData; do
not uninstall with data removal. The new free build then remains manual-only.
Old installers/feeds must be reviewed/retired separately by the release owner;
this PR does not modify the releases repository or any published binary/link.

## Validation boundary

The publication gate extracts package.json from the actual built app.asar,
checks the embedded mode (and installed publisher config in signed mode), and
rejects a manual output directory containing latest.yml. Unit tests cover
free/signed policy, no-updater early return and release gates.
Windows packaging, actual Authenticode/SmartScreen, installed update migration and
manual publication need Windows release verification before any real rollout.
No release/deployment is authorized by merely updating this draft PR.

Research: repository lock pins electron-updater 6.8.9. Its NsisUpdater.verifySignature
returns null when installed publisherName is absent; hashes/HTTPS alone therefore
do not create a signature trust anchor. We leave the built-in verifier enabled
and never start that updater at all in the free/manual mode.
