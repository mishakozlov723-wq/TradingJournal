# Accounts Space — v3.24 multi-user setup

The proxy is deployed once by the Trading Journal owner. Other users do **not** deploy Vercel, edit code, or manage environment variables.

## One-time owner upgrade

1. Open `accounts-proxy-vercel`.
2. Run `UPGRADE-MULTIUSER.bat`.
3. Wait for `MULTI-USER UPGRADE FINISHED`.

The production endpoint stays:

`https://trading-journal-accounts-proxy.vercel.app/api/myfxbook`

## What each Trading Journal user does

1. Sign in to Trading Journal.
2. Open **Settings → Accounts**.
3. Enter their own **Myfxbook email and Myfxbook password**.
4. Press **Connect Myfxbook**.
5. Their Myfxbook accounts appear only under their Firebase user.

The password is not saved in the frontend. The server validates it and returns an encrypted connection token bound to that Firebase UID.

## Multiple MT5/FundedNext accounts for one user

A single Myfxbook profile can contain several trading accounts. Add the second FundedNext account to the same Myfxbook profile with its Investor Password, then press **Refresh** in Trading Journal. No second Vercel deployment is required.

## Important limitation

Free Myfxbook Auto Update is delayed. Trading Journal can refresh only the data already synchronized into Myfxbook; it cannot force FundedNext/MT5 to update Myfxbook in real time.
