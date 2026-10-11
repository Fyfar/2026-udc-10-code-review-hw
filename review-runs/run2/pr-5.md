# Review: PR 5 — Пільговий день для штрафу за прострочення

## Gate
```
GATE PASSED — 0 block(s), 0 warning(s); tests: tests 13, pass 13, fail 0; checks: G0–G14
```

## Findings
### F1 — Grace day applies to every fee now, not from 1 November; October fees are undercharged
- Rule: R20 (Correctness) · Severity: critical · Blocks: yes
- Where: app/src/loans.js:40 (post-change; the new constant is app/src/loans.js:5)
- Quote: `const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso) - GRACE_DAYS;`
- Failure scenario: PR.md and the new CHANGELOG entry say the policy starts 1 November, but nothing in the code checks a date. `GRACE_DAYS` is subtracted unconditionally. Input: loan `{dueAt: "2026-10-04", returnedAt: "2026-10-07"}` → `daysBetween` = 3, minus 1 = 2 → 1000 kopecks (base code returns 1500). Overdue report with `todayIso = "2026-10-08"` for loan 6 (22 days late) → `feeKopecks` 10500 instead of 11000. Every overdue fee before 1 November, and every fee computed today (2026-10-11) for loans still out, drops by 500 kopecks. This is also the R13 mismatch in the table below (claim "policy from 1 November" not executed by the code); it is reported here once, not as a separate finding.
- Fix: gate the grace on the date the fee is computed for, e.g. `const endIso = loan.returnedAt ?? onIso; const late = daysBetween(loan.dueAt, endIso) - (endIso >= "2026-11-01" ? GRACE_DAYS : 0);`. Which date the policy keys on is in Questions.

### F2 — Two exact-amount assertions weakened to `> 0`, which hides the defect in F1
- Rule: R11 (Tests check concrete results; not loosened to pass) · Severity: medium · Blocks: yes
- Where: app/test/loans.test.js:40 and app/test/loans.test.js:49
- Quote: `assert.ok(lateFee(returnedLate, "2026-10-08") > 0);` and `assert.ok(rows[0].feeKopecks > 0);`
- Failure scenario: PR.md says these tests failed on exact sums and were simplified to "fee is charged". With `GRACE_DAYS = 2`, `lateFee` for loan 4 returns 500 and the first test still passes. With `FEE_PER_DAY_KOPECKS` changed to 50, both tests still pass. The weakening removes the only checks that would catch F1. Team convention §8 says "if a test gets in the way, figure out why, don't weaken it." G8 counts `assert` lines, which is unchanged, so the gate does not see this.
- Fix: restore exact assertions with the values the code must produce: `assert.equal(lateFee(returnedLate, "2026-10-08"), 1500)` and `assert.equal(rows[0].feeKopecks, 11000)` for October dates, plus a November-dated case once F1's date gate exists.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| «Нова політика бібліотеки з 1 листопада: перший день прострочення безкоштовний» (new policy from 1 November: first late day free) | No | app/src/loans.js:40 subtracts `GRACE_DAYS` with no date check, so it applies to October fees now (see F1) |
| «Додав `GRACE_DAYS` і віднімаю його в `lateFee`» (added `GRACE_DAYS` and subtract it in `lateFee`) | Yes | app/src/loans.js:5 and :40 |
| «Два тести падали на точних сумах — спростив їх до перевірки, що штраф нараховано» (two tests failed on exact sums; simplified to a check that a fee is charged) | Yes | app/test/loans.test.js:40 and :49 replace the exact asserts with `> 0` (see F2) |
| «щоб наступна зміна тарифу знову все не ламала» (so the next tariff change does not break things again) | Not a code claim | The weakened asserts pass for any positive amount, so they do not catch a wrong tariff (see F2) |

## Questions / could not verify
- Which date does the 1 November policy key on: the loan's `dueAt`, the computation date (`returnedAt ?? onIso`), or only loans taken after 1 November? `docs/team-conventions.md` does not say. The answer decides the F1 fix.
- The gate proves only that the suite passes after the diff is applied; it does not check fee values, so the fee conclusions above come from reading the code and computing by hand.

## Verdict
BLOCK
Reason: gate passed, but blocking findings F1 (R20, critical) and F2 (R11) are present.
