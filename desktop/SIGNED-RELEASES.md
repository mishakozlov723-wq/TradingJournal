# v1.3.13: existing GitHub auto-updates, optional Authenticode

This supersedes the manual-only v3 audit policy, which was not released.
The user's requirement is to retain GitHub update UX without mandatory paid signing.
TJ-18 is reclassified: absent Authenticode alone is NOT a separately proven exploit.
Compromising the trusted GitHub publisher/token is a residual supply-chain threat,
not a bug that can be fixed by disabling the requested feature.

## Existing default trust model

The installed config selects github / mishakozlov723-wq / syter-releases. Runtime
checks that identity, retains electron-updater's built-in checks, sets no downgrade
or prerelease, and uses the existing lifecycle controller with user consent.
HTTPS/GitHub account controls authenticate the channel; feed SHA512 validates the
actual downloaded bytes, not an independent signer. GitHub-controlled metadata
can be replaced together with a malicious binary after publisher compromise.
No made-up signature, key or required new signing infrastructure is introduced.
Built-in Authenticode verification remains enabled: when installed publisherName
exists, electron-updater verifies it; without publisherName it has no publisher
trust anchor. We do not turn that existing check off.

Default `SYTER_SIGNED_RELEASE=false` builds without certificate, embeds policy
`github`, prepares latest.yml + Setup EXE + blockmap and native wrapper/manifest.
The workflow validates actual app.asar policy/app-update.yml, feed version/path,
SHA512/size, manifest payload SHA256/size and EXE headers. Publication is full-gated,
main-only, draft-first; public tags/assets must never be overwritten.
Windows/SmartScreen can still warn about an unknown publisher.

## Optional signed mode

`SYTER_SIGNED_RELEASE=true` requires real protected CSC_LINK/CSC_KEY_PASSWORD and
exact SYTER_PUBLISHER_NAME; incomplete setup fails, never downgrades. Both EXEs
are signed and signatures/publisher/timestamp checked. No certificate purchase
is required for the default GitHub mode. Signer transitions/rotation require a
separately planned compatibility check, not a silent forced migration.

## v1.3.12 -> v1.3.13 and future updates

Both versions use the same appId, GitHub repo and NSIS feed asset naming. v1.3.13
publishes a normal latest.yml/Setup/blockmap feed and keeps userData. It neither
patches old updater code remotely nor adds a new mandatory signer. Old v1.3.12
should discover the new stable version through its existing GitHub provider;
actual native install/update must be tested separately and not inferred from
metadata compatibility. If auto-update fails, a verified v1.3.13 installer is a
fallback, not a replacement for GitHub auto-update. Future releases keep the feed.
No old tag/feed is deleted/rewritten by this change.

## Rollout

Desktop wraps the live HTTPS web journal, not a bundled replacement of frontend.
Web and repository rules must be rolled out compatibly with cached clients. See
RELEASE-1.3.13.md. Native Windows build/installer checks and metadata/integrity
results are recorded in CI; user-account/production-data operations are not tests.
