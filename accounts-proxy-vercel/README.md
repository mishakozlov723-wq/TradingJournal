# Accounts proxy — Vercel Hobby ($0), multi-user

One Vercel proxy serves every authenticated Trading Journal user.

Users connect Myfxbook **inside Trading Journal**. The proxy validates the Firebase ID token, validates Myfxbook credentials, then returns an encrypted connection token bound to that Firebase UID. Plaintext user Myfxbook credentials are never placed in the public site.

## Environment variables

Recommended for a fresh deployment:

- `FIREBASE_WEB_API_KEY`
- `ACCOUNTS_CREDENTIAL_SECRET` — a long random server-only secret used to encrypt per-user connection tokens.
- `ALLOWED_ORIGIN` — optional exact Trading Journal origin.

Optional:

- `ACCOUNTS_ENFORCE_ALLOWLIST=1` together with `ALLOWED_FIREBASE_UIDS` if Accounts should be restricted again.

Migration compatibility:

- Existing v3.23 deployments can keep the old `MYFXBOOK_PASSWORD` Vercel secret. v3.24 can use it as the encryption root when `ACCOUNTS_CREDENTIAL_SECRET` has not been created yet.
- `MYFXBOOK_EMAIL` is no longer used for per-user account access.

## Existing project upgrade

Run `UPGRADE-MULTIUSER.bat`.

The endpoint remains:

`https://trading-journal-accounts-proxy.vercel.app/api/myfxbook`
