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
| «Хелпери дат переїхали в окремий модуль» | Yes | New `app/src/dates.js` (lines 6–15) holds `toUtcMs`, `daysBetween`, `addDays`; the helper block is removed from `app/src/loans.js` (diff hunk `@@ -1,22 +1,11 @@`). |
| «`loans.js` реекспортує їх, тож імпорти не ламаються» | Yes | `app/src/loans.js:4`: `export { addDays, daysBetween } from "./dates.js";`. `app/test/loans.test.js:4` still imports both from `loans.js`. |
| «Перейменував пару змінних для ясності» | Yes | `toUtc` → `toUtcMs` (`dates.js:8`, `:12`, `:16`); `late` → `daysLate` in `lateFee` (`loans.js:28–29`). |
| «додав тести на хелпери» | Yes | `app/test/dates.test.js` adds 3 `test(...)` blocks for `addDays`, `daysBetween`, `toUtcMs`. |
| «Поведінка не змінюється» | Yes | Bodies are identical: same `Date.UTC(...)` parse, same `86_400_000` value (now `MS_PER_DAY`), same `Math.round` and `toISOString().slice(0, 10)`. `lateFee` change is a local rename only. |
| «щоб ними могли користуватись і учасники, і звіти» | Not verifiable | Rationale, not a behaviour claim. No member or report code in this PR uses `dates.js` yet. |

## Questions / could not verify
- Gate WARN G7 at `app/src/dates.js:4` points at `const MS_PER_DAY = 86_400_000;`. This is the single definition inside the helper module that the helpers use, so it is the intended reuse point rather than a duplicate. No finding raised (R18 is non-blocking in any case).
- `app/test/dates.test.js:14–16` (`toUtcMs ignores the local time zone`) passes under any implementation on a UTC runner. It only catches a future local-time regression when the suite runs in a non-UTC time zone. The current code is correct, so this is not raised as a finding. Could not verify the TZ of the CI runner (CI config is out of scope).

## Verdict
APPROVE (advisory)
Reason: gate passed, no blocking findings.
