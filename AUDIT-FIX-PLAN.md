# TJ audit remediation
Base: 889428625de06e3b27a7ed850904a2ecdfb7b574. Branch: fix/audit-tj-01-18-data-safety.
No merge, production deploy, release, production data/rules/secret changes authorized.

1. TJ-01 durable pending/baseline metadata; conflict regardless of device clock, including empty workspace.
2. TJ-02 recover missing pages only; preserve healthy cloud pages, never wholesale local overwrite.
3. TJ-03 acknowledge durable close before removing Replay position; retain failed close for retry.
4. TJ-04 preserve upstream execution identity, multiplicity and updates; conservative legacy fallback.
5. TJ-05 atomic bounded asset settings/trades/images changes; no partial success; explicit scope.
6. TJ-06 retain Diary editor/draft on error and retry.
7. TJ-07 serialize Diary create; retain edits made during request.
8. TJ-08 prevent modal lifecycle races during pending trade write.
9. TJ-09 fail closed on quote-download errors; stage output before promoting files.
10. TJ-10 strict bounded numeric inputs and finite statistics handling.
11. TJ-11 safe direction rendering in all shared sinks; source Firestore enum validation.
12. TJ-12 remove lossy collection slicing; retain limits as explicit save rejection, never data truncation.
13. TJ-13 remove all sharing capability from duplicated page subtree.
14. TJ-14 preserve failed-load baseline and retry cloud load without page refresh.
15. TJ-15 durable owner-scoped trade note drafts, replay/retry without false acknowledgement.
16. TJ-16 isolate malformed outbox entries without deletion or core journal failure.
17. TJ-17 visible Diary delete errors and retry.
18. TJ-18 signed future desktop releases only, fail-closed publisher checks and release gates; existing v1.3.12 unchanged. Certificate is external prerequisite.

Verification: safe reviewed existing tests, isolated VM/DOM red/green regressions, syntax and security checks. No real Firebase/Myfxbook connections. All findings independently reviewed after edits. Partial repository baseline available locally; missing test/source dependencies must be retrieved before claiming full coverage.
