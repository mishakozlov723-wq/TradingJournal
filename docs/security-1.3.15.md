# Security and shutdown follow-up — SYTER 1.3.15

MovieTracker is explicitly excluded. Its rule block is unchanged.

## Desktop

Mode requests now stop during quit, after the window/view closes and when either
native object is destroyed. Closing clears readiness and clipboard polling;
quit also unregisters the shortcut early. Existing GitHub publisher identity,
consent, profile preservation and all installer gates remain enabled.

## Accounts proxy (Vercel and Netlify)

- No wildcard CORS response. Default permitted origins are the two production
  journal hosts. An existing `ALLOWED_ORIGIN=*` is narrowed to those hosts.
  Explicit comma-separated HTTPS origins may be configured. Disallowed browser
  origins receive 403 before authentication/upstream work. Requests without an
  Origin header still require exactly the same Firebase and connection checks;
  CORS is not an authentication boundary.
- New credential tokens are v3 AES-256-GCM. They never derive their key from a
  Myfxbook login password. A dedicated random `ACCOUNTS_CREDENTIAL_SECRET` of at
  least 32 bytes is preferred. If absent, HKDF-SHA256 derives a domain-separated
  key from the protected Firebase service-account private key already required
  for connection revocation. No secret value is returned or logged.
- Changing the active dedicated secret or service-account key is a key rotation,
  not an ordinary login-password change: plan token migration/reconnection.
  A configured but weak dedicated secret fails closed rather than silently
  falling back. Configuration must be checked before rollout.
- v2 compatibility is DECRYPT-ONLY, accepts tokens issued before 2026-10-29 UTC,
  and ends 2026-11-28 UTC. The original 30-day expiry, UID binding and server-side
  generation revocation checks remain enforced. Successful requests return a
  v3 replacement with the ORIGINAL issuance time; the client stores it only if
  both the current UID and original token are unchanged. No automatic session
  lifetime extension or logout reversal. Existing password fallback remains
  only in this time-limited reader, never in new encryption.

## Notes images

Original `notesImages` documents are owner/admin-readable, not public by ID.
Public snapshots publish separate `notesShares/{token}/images/{imageId}` copies.
Copies can be staged only from the authenticated owner's exact original bytes;
anonymous access requires an existing parent, matching owner and explicit image
ID in its manifest. Enumeration is denied. Removing an image from the manifest
or disabling the parent link denies subsequent server reads. Already downloaded
bytes cannot be recalled from someone else's device (as with any public share).

Before activating rules, the deploy workflow additively copies only images
referenced in already-public snapshots, verifies bytes and publishes manifests
with update-time preconditions. Missing/foreign/malformed sources stop rollout.
No private page or original image is changed/deleted. Old public subcollection
copies may remain unreachable after revocation; no destructive cleanup runs.
Old cached clients must reload to use the private/scoped image resolver.

## Trade images

New/updated image documents must point to an owned normal or backtest trade.
`getAfter` supports atomic creation of the parent and up to ten images. Existing
orphan images remain owner-readable and deletable, not silently deleted.

## Verification

Isolated unit tests cover actual proxy handlers, origin rejection, new/legacy
credential formats, expiry, UID/revocation, migration failure and cache scoping.
Loopback Firestore tests cover anonymous/foreign reads, revocation, atomic parent
creation and missing/foreign trade rejection. Full repository/browser/Windows
checks and the real 1.3.14 -> 1.3.15 update gate must pass before publication.
