# Monochrome interface preview

This is an opt-in first interface pass, not a replacement of the classic interface.

- Entry: existing desktop `syter:interface-preview-toggle` event or Ctrl+Shift+0 on the website. No on-screen invitation or style selector.
- Session-only: reload starts in classic. The shortcut toggles back without reloading.
- No new theme/preferences storage or account/trading-data writes.
- `public/interface-mono.css` is gated by the root attribute. Classic app.css is unchanged.
- Navigation delegates to native workspace enter/exit handlers (including Replay flush and Notes save), not a second application shell or duplicate data source.
- Default Replay candle/chart colors have a monochrome presentation overlay. Stored settings are not rewritten. Non-default/custom choices remain editable, and Cancel restores the native snapshot.
- Existing transactions, risk/statistics logic, model filtering, Notes content/database tools and API integration remain the original implementation.
- Only opt-in mode skips decorative workspace transition waits.

## Verification

```
node --test tests/interface-mono.test.cjs tests/backtest-model-filter.test.cjs tests/chart-resize.test.cjs
CHROME_PATH=/usr/local/bin/chromium node tests/interface-mono.browser.cjs
```

The browser runner requires Node 24+ and Chromium. It serves the actual application locally, intercepts external requests, uses a local Firestore double, synthetic OHLC and mocked Accounts responses. It does not sign into production or inspect actual user accounts. PNGs and results go to `$SYTER_QA_DIR` or a temporary directory.

Covered: classic default/restore, form value retention, navigation/collapse, wide and 390px layout, filters, model statistics, actual Replay chart/settings/color edits/cancel, parsed Accounts list/detail, Notes page title/edit flow, period views, reduced motion and uncaught runtime errors.

This is not Windows EXE testing, Myfxbook live verification, or exhaustive testing of every Notes block/database operation. The older full trading-models test has a separately documented pre-existing fixture failure; it is not represented as passing here. Review live account-specific layouts before considering the redesign final.

## Publishing

The existing Deploy website workflow remains manual. Publishing website assets is separate from releasing or rebuilding the 1.3.0 EXE. This change does not dispatch deployment or build a new desktop installer.
