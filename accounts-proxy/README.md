# Accounts proxy — Netlify alternative ($0), multi-user

This is the Netlify equivalent of the Vercel proxy. One deployment can serve every Firebase-authenticated Trading Journal user.

Environment variables (template: `.env.example`; set them in Netlify → Site configuration → Environment variables):

Required:
- `FIREBASE_WEB_API_KEY`
- `ACCOUNTS_CREDENTIAL_SECRET` — at least 32 random bytes (a shorter value makes every request answer `503`); if not set, the key is derived from `FIREBASE_SERVICE_ACCOUNT`.
- `FIREBASE_SERVICE_ACCOUNT` — full JSON of a Firebase service account key (one value). Without it every Accounts request answers `503 REVOCATION_NOT_CONFIGURED`. Its `project_id` must match `FIREBASE_PROJECT_ID` (default `retocker`).

Recommended:
- `ALLOWED_ORIGIN` — exact HTTPS site origins allowed to call the proxy, comma-separated (for example `https://retocker.web.app`). Empty or `*` means only `https://retocker.web.app` and `https://retocker.firebaseapp.com`.

Optional:
- `FIREBASE_PROJECT_ID`, `ACCOUNTS_ENFORCE_ALLOWLIST=1` + `ALLOWED_FIREBASE_UIDS`.

Per-user Myfxbook credentials are entered in Trading Journal and exchanged for a Firebase-UID-bound encrypted connection token. Do not put user Myfxbook passwords in `public/`.

Every proxy request logs in to Myfxbook and logs out again (no server-side session). Myfxbook limits logins, so refresh Accounts only when needed — see `accounts-proxy-vercel/README.md` for details.
