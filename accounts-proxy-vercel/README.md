# Accounts proxy — Vercel Hobby ($0), multi-user

One Vercel proxy serves every authenticated Trading Journal user.

Users connect Myfxbook **inside Trading Journal**. The proxy validates the Firebase ID token, validates Myfxbook credentials, then returns an encrypted connection token bound to that Firebase UID. Plaintext user Myfxbook credentials are never placed in the public site.

## Environment variables

See `.env.example` for a template. Set them in Vercel → Project → Settings → Environment Variables (Production), then redeploy.

Required:

- `FIREBASE_WEB_API_KEY` — the Web API key of the Firebase project (used to verify users' ID tokens).
- `ACCOUNTS_CREDENTIAL_SECRET` — a long random server-only secret (at least 32 bytes) used to encrypt per-user connection tokens. A shorter value is rejected: every Accounts request answers `503`. If it is not set, the key is derived from `FIREBASE_SERVICE_ACCOUNT`. Changing the secret (or, without it, the service account key) disconnects every user (they reconnect once).
- `FIREBASE_SERVICE_ACCOUNT` — the **full JSON** of a Firebase service account key, pasted as one value. The proxy uses it to read/write `accountConnectionRevocations/{uid}` (so "Disconnect" really revokes old tokens). Without it every Accounts request fails with `503 REVOCATION_NOT_CONFIGURED`.
  - Create it in Firebase console → Project settings → Service accounts → *Generate new private key*.
  - Its `project_id` must match `FIREBASE_PROJECT_ID` (default `retocker`).
  - Treat it like a password: never commit it, never put it into `public/`.

Recommended:

- `ALLOWED_ORIGIN` — exact HTTPS site origins that may call the proxy from a browser, comma-separated, no trailing slash, e.g. `https://retocker.web.app` (this is also what the desktop app loads). If empty or `*`, only `https://retocker.web.app` and `https://retocker.firebaseapp.com` are allowed. Other browser origins get `403`; every request still needs a valid Firebase sign-in.

Optional:

- `FIREBASE_PROJECT_ID` — only if the Firebase project is not `retocker`.
- `ACCOUNTS_ENFORCE_ALLOWLIST=1` together with `ALLOWED_FIREBASE_UIDS` (comma-separated UIDs) if Accounts should be restricted to specific users.

Migration compatibility:

- Connection tokens issued by older versions (encrypted with `ACCOUNTS_CREDENTIAL_SECRET` or the old `MYFXBOOK_PASSWORD`) are only read for a limited time and replaced with new tokens on the next successful request. New tokens are never encrypted with `MYFXBOOK_PASSWORD`. Details: `docs/security-1.3.15.md`.
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

## Face ID / fingerprint sign-in (`api/passkey.js`)

Phones can sign in to SYTER with Face ID or a fingerprint (WebAuthn passkeys). The
phone keeps the private key; this function stores only the public key in Firestore
`/passkeyCredentials` (server-only, browsers are denied by the default rule), checks
the signature and returns a short-lived Firebase sign-in token. It reuses the existing
`FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_WEB_API_KEY`; no new settings are needed.
The normal password sign-in always keeps working.
