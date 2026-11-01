# Accounts proxy — Vercel Hobby ($0), multi-user

One Vercel proxy serves every authenticated Trading Journal user.

Users connect Myfxbook **inside Trading Journal**. The proxy validates the Firebase ID token, validates Myfxbook credentials, then returns an encrypted connection token bound to that Firebase UID. Plaintext user Myfxbook credentials are never placed in the public site.

## Environment variables

See `.env.example` for a template. Set them in Vercel → Project → Settings → Environment Variables (Production), then redeploy.

Required:

- `FIREBASE_WEB_API_KEY` — the Web API key of the Firebase project (used to verify users' ID tokens).
- `ACCOUNTS_CREDENTIAL_SECRET` — a long random server-only secret used to encrypt per-user connection tokens. Changing it disconnects every user (they reconnect once).
- `FIREBASE_SERVICE_ACCOUNT` — the **full JSON** of a Firebase service account key, pasted as one value. The proxy uses it to read/write `accountConnectionRevocations/{uid}` (so "Disconnect" really revokes old tokens). Without it every Accounts request fails with `503 REVOCATION_NOT_CONFIGURED`.
  - Create it in Firebase console → Project settings → Service accounts → *Generate new private key*.
  - Its `project_id` must match `FIREBASE_PROJECT_ID` (default `retocker`).
  - Treat it like a password: never commit it, never put it into `public/`.

Recommended:

- `ALLOWED_ORIGIN` — the exact site origin that may call the proxy from a browser, e.g. `https://retocker.web.app` (this is also what the desktop app loads). One origin only, no trailing slash. If empty, CORS answers `*` (any site); requests still need a valid Firebase sign-in, but restricting the origin is safer.

Optional:

- `FIREBASE_PROJECT_ID` — only if the Firebase project is not `retocker`.
- `ACCOUNTS_ENFORCE_ALLOWLIST=1` together with `ALLOWED_FIREBASE_UIDS` (comma-separated UIDs) if Accounts should be restricted to specific users.

Migration compatibility:

- Existing v3.23 deployments can keep the old `MYFXBOOK_PASSWORD` Vercel secret. v3.24 can use it as the encryption root when `ACCOUNTS_CREDENTIAL_SECRET` has not been created yet.
- `MYFXBOOK_EMAIL` is no longer used for per-user account access.

## How Myfxbook sessions are used

The proxy keeps no server-side session: **every request (connect, account list, account details) logs in to Myfxbook, does its work and logs out again.** Myfxbook limits how often a profile may log in, so:

- Trading Journal never refreshes Accounts on a timer — only when the Accounts page or an account opens, or **Refresh** is pressed. Avoid pressing Refresh repeatedly; Myfxbook itself updates its data with a delay anyway.
- Opening one account's details is a single login, regardless of how many history/open-trade/daily requests it makes.
- If Myfxbook starts refusing logins ("too many requests"), wait a few minutes before refreshing again.

## Existing project upgrade

Run `UPGRADE-MULTIUSER.bat`.

The endpoint remains:

`https://trading-journal-accounts-proxy.vercel.app/api/myfxbook`
