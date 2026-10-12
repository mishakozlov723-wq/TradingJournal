# Accounts proxy — Netlify alternative ($0), multi-user

This is the Netlify equivalent of the Vercel proxy. One deployment can serve every Firebase-authenticated Trading Journal user.

Recommended environment variables:
- `FIREBASE_WEB_API_KEY`
- `ACCOUNTS_CREDENTIAL_SECRET`
- optional `ALLOWED_ORIGIN`

Per-user Myfxbook credentials are entered in Trading Journal and exchanged for a Firebase-UID-bound encrypted connection token. Do not put user Myfxbook passwords in `public/`.
