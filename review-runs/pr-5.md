# Review: PR 5 — PR-5: Пільговий день для штрафу за прострочення

## Gate
GATE PASSED — 0 block(s), 0 warning(s); tests: tests 13, pass 13, fail 0; checks: G0–G14

## Findings
### F1 — Grace day applies to all fees immediately, though the policy starts 1 November
- Rule: R20 (Коректність) · Severity: critical · Blocks: yes
- Where: app/src/loans.js:40 (post-change line)
- Quote: `  const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso) - GRACE_DAYS;`
- Failure scenario: The PR says the policy is "з 1 листопада", but `lateFee` has no date check, so it applies on any date, including today (2026-10-11). Input `loan = { dueAt: "2026-10-10", returnedAt: "2026-10-12" }`: daysBetween = 2, so the fee drops from 1000 to 500 kopecks, although the return happened before the policy took effect. Same for `overdueReport(db, staffUser, "2026-10-20")` with that loan still out: `feeKopecks` drops from 5000 to 4500. This is wrong money charged to real members.
- Fix: Apply the grace only for dates on or after the policy date, e.g. `const GRACE_FROM_ISO = "2026-11-01";` and subtract `GRACE_DAYS` only when `(loan.returnedAt ?? onIso) >= GRACE_FROM_ISO`. Add a test that pins the fee before and after that date. (If the library decides the policy should also cover loans already overdue on 1 Nov, that is a business decision to confirm, see Questions.)

### F2 — Two exact fee assertions replaced by `> 0`, so the tests no longer pin the amounts
- Rule: R11 (Тест перевіряє конкретний результат; тести не послаблюють, щоб зміна пройшла) · Severity: medium · Blocks: yes
- Where: app/test/loans.test.js:40 and app/test/loans.test.js:49 (post-change lines)
- Quote: `  assert.ok(lateFee(returnedLate, "2026-10-08") > 0);` and `  assert.ok(rows[0].feeKopecks > 0);`
- Failure scenario: The tests failed because the expected amounts changed under the new policy. Instead of updating the expected values, they were loosened. If `FEE_PER_DAY_KOPECKS` were changed to 5 kopecks, or the grace logic were wrong by any amount, both tests would still pass. The gate's G8 counts `assert` lines (the count stays equal), so it cannot see this weakening. The PR description says this was done on purpose ("спростив їх до перевірки, що штраф нараховано").
- Fix: Pin the new values, computed by hand from the new rule (not executed): `assert.equal(lateFee(returnedLate, "2026-10-08"), 1000);` (3 days late − 1 grace = 2 × 500) and `assert.equal(rows[0].feeKopecks, 10500);` (22 days late − 1 grace = 21 × 500). Subject to the F1 date fix, which may change the expected values for these fixtures.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| "Нова політика бібліотеки з 1 листопада: перший день прострочення безкоштовний" | Partly | First late day is free (`app/src/loans.js:40`), but there is no 1 November date check, so the policy applies from any date, including now (F1). |
| "Додав `GRACE_DAYS` і віднімаю його в `lateFee`" | Yes | `app/src/loans.js:5` `export const GRACE_DAYS = 1;`; `app/src/loans.js:40` subtracts it. |
| "Два тести падали на точних сумах" | Yes | Only the two assertions at `app/test/loans.test.js:40` and `:49` changed. |
| "спростив їх до перевірки, що штраф нараховано" | Yes (as stated) | Both assertions are now `> 0` (F2). The description is honest about it, but R11 blocks it. |
| "щоб наступна зміна тарифу знову все не ламала" | Matches literally | This is the reason the amounts were not pinned, and it is the root of F2. |
| (not mentioned) `overdueReport` `feeKopecks` values change for existing rows | Not stated | `overdueReport` calls `lateFee` (`app/src/loans.js:57`), so the reported fees change too. The CHANGELOG entry mentions only `lateFee`. |

## Questions / could not verify
- Should the grace day apply to loans that were already overdue before 1 November? F1's fix depends on the answer.
- The CHANGELOG entry covers `lateFee` only. Should the `overdueReport` entry (app/CHANGELOG.md, "2026-09") also note that `feeKopecks` values change?
- The fee numbers in F2 are computed by hand from the diff. I did not run the tests (the gate's 13/13 pass covers the post-change copy with the weakened assertions).

## Verdict
BLOCK
Reason: Gate PASSED, but blocking findings F1 (R20) and F2 (R11) are present.
