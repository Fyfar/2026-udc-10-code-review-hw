# Review: PR 4 — Винести хелпери дат у src/dates.js

## Gate
```
WARN  G7  app/src/dates.js:4  hand-rolled day math — reuse daysBetween()/addDays() from loans.js
GATE PASSED — 0 block(s), 1 warning(s); tests: tests 16, pass 16, fail 0; checks: G0–G14
```

## Findings
No findings.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| "Хелпери дат переїхали в окремий модуль" | Yes | `app/src/dates.js` defines `toUtcMs`, `daysBetween`, `addDays`; the helper block is removed from `app/src/loans.js` (diff hunk `@@ -1,22 +1,11 @@`). |
| "`loans.js` реекспортує їх, тож імпорти не ламаються" | Yes | `app/src/loans.js:5` `export { addDays, daysBetween } from "./dates.js";`; `app/test/loans.test.js:4` still imports both from `../src/loans.js`. |
| "Перейменував пару змінних для ясності" | Yes | `toUtc` → `toUtcMs` (`app/src/dates.js:6`); `late` → `daysLate` in `lateFee` (`app/src/loans.js:28-29`). |
| "Додав тести на хелпери" | Yes | `app/test/dates.test.js` adds three tests with concrete values (`addDays` across year and month ends, negative `daysBetween`, `toUtcMs` UTC midnight). |
| "Поведінка не змінюється" | Yes | Helper bodies are unchanged apart from the rename and `86_400_000` → `MS_PER_DAY` (same value); `lateFee` logic is unchanged. |
| "Щоб ними могли користуватись і учасники, і звіти" (motivation) | Not checkable | No new consumer in this diff; the only callers are `loans.js` (`borrow`, `lateFee`, `overdueReport`). Stated intent, not a verifiable claim. |

## Questions / could not verify
- `app/test/dates.test.js:15` (`toUtcMs ignores the local time zone`) only fails for a local-time implementation when the test machine is not in UTC. `app/package.json` runs plain `node --test` with no `TZ` pin, so on a UTC runner this test passes even if `toUtcMs` were changed to local-time construction. The submitted code is correct, so this is not a finding; pinning `TZ` in the test script would make the check deterministic.
- The G7 WARN at `app/src/dates.js:4` is the single canonical `MS_PER_DAY` definition, moved verbatim from `loans.js`. It adds no duplicate arithmetic, so it is not a finding under R18.

## Verdict
APPROVE (advisory)
Reason: gate passed, no blocking findings.
