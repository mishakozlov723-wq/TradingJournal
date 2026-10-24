# Signed release prerequisite (TJ-18)

Existing published v1.3.12 binaries are NOT changed by this source PR. No release or deployment was performed.

Future NSIS builds fail unless `SYTER_PUBLISHER_NAME` (the real certificate simple subject name), `CSC_LINK` and the certificate password as needed are securely configured. Never put certificate material or its password in source/chat. The builder requires signing and writes `publisherName` into app-update.yml. An installed build without a publisher anchor disables automatic updates rather than treating a null signature result as success.

GitHub Actions expects protected secrets `SYTER_CSC_LINK`, `SYTER_CSC_KEY_PASSWORD`, and repository variable `SYTER_PUBLISHER_NAME`. The native wrapper signing script accepts a local or base64 PFX (not a URL), requires the same approved publisher and a trusted timestamp; the final gate checks BOTH Setup and Install binaries and refuses publication otherwise. Windows certificate-chain/timestamp validation and an actual signed update require a Windows runner and a real trusted certificate. Reduced `notes_only`, `installer_only`, reused-payload and check-only runs cannot publish.

Migration must be approved separately: manually obtain a verified signed new installer, validate its publisher, then install it over the old version while preserving the user profile. A source change cannot retroactively add publisher trust to installed unsigned v1.3.12. Certificate rotation and initial distribution require explicit release-owner approval. Do not re-sign or overwrite an existing public version.

The signing script has NOT been run on Windows with a real certificate in this PR. It intentionally fails closed if signing, timestamping or chain validation cannot complete. No certificate was requested because a release was not authorized.
