# Review: PR h3 — Повернення книжки

## Gate
```
GATE PASSED — 0 block(s), 0 warning(s); tests: tests 17, pass 17, fail 0; checks: G0–G14
```

## Findings
### F1 — A member can backdate their own return date and waive the late fee
- Rule: R20 (correctness) · Severity: critical · Blocks: yes
- Where: app/src/loans.js:48-49 (post-change)
- Quote: `  loan.returnedAt = onIso;` and `  return { loanId: loan.id, returnedAt: onIso, feeKopecks: lateFee(loan, onIso) };`
- Failure scenario: Olya (id 1, member) owns loan 2 (takenAt 2026-09-10, dueAt 2026-09-24, still out). Today is 2026-10-08, so the correct late fee is 14 × 500 = 7000 kopecks. She calls `returnLoan(db, olya, 2, "2026-09-24")`. The owner check at loans.js:45 passes, the date passes the regex and is not before takenAt, and the call returns `feeKopecks: 0` with `returnedAt` set to 2026-09-24. The desk collects nothing. The caller chooses the date that drives the fee, so a member can waive their own late fee (wrong money).
- Fix: For non-staff, use the desk's date rather than the argument. Pass `todayIso` (as `overdueReport` does) and use `const when = isStaff(user) ? onIso : todayIso;` in lines 48-49. The signature change needs a CHANGELOG line (R9). Add a test: olya returns loan 2 with an earlier date, and the fee is 7000.

### F2 — Impossible calendar dates pass validation and are stored
- Rule: R20 (correctness) · Severity: high · Blocks: yes
- Where: app/src/loans.js:47
- Quote: `  if (!/^\d{4}-\d{2}-\d{2}$/.test(onIso) || onIso < loan.takenAt) throw new Error("bad return date");`
- Failure scenario: Iryna (id 3, librarian) closes loan 3 (takenAt 2026-09-05, dueAt 2026-09-19) and types 2026-13-45. The regex accepts it, and the string comparison with takenAt passes because "13" sorts after "09". `returnedAt` is stored as "2026-13-45". The fee is computed on the normalized date 2027-02-14: 148 × 500 = 74000 kopecks (740 грн) for a date that does not exist. A typo such as 2026-09-31 is accepted the same way, with a fee computed for 2026-10-01 (6000 kopecks).
- Fix: Reject dates that do not exist, keeping the regex first so `addDays` never gets a malformed string: `if (!/^\d{4}-\d{2}-\d{2}$/.test(onIso) || addDays(onIso, 0) !== onIso || onIso < loan.takenAt) throw new Error("bad return date");`. Add a test: `returnLoan(createDb(), iryna, 3, "2026-09-31")` throws /bad return date/.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| Staff closes any loan | Yes | loans.js:45 `!isStaff(user) && …` skips the owner check for staff; test/loans.test.js:56-61 (staff closes member 2's loan 3) |
| Member closes only their own loan | Yes | loans.js:45 `loan.memberId !== user.id` throws AccessDenied; test/loans.test.js:67-71 |
| Return date comes in as a parameter | Yes | loans.js:41 `onIso` (but see F1: a member also controls it) |
| Fee computed with the existing lateFee and returned | Yes | loans.js:49 `feeKopecks: lateFee(loan, onIso)`; test/loans.test.js:59 expects 1500 for 3 late days |
| Repeat return rejected | Yes | loans.js:46; test/loans.test.js:73-75 |
| Return date before issue rejected | Yes | loans.js:47 `onIso < loan.takenAt`; test/loans.test.js:75 (2026-09-01 < 09-10). The impossible-date gap is F2 |
| Tests, including the denial test | Yes | test/loans.test.js:56-76; denial test at 67-71 |
| CHANGELOG entry | Yes | app/CHANGELOG.md, "## 2026-10" entry lists the function, its parameters and its return shape |

## Questions / could not verify
- Future return dates are accepted: `returnLoan(db, iryna, 3, "2030-01-01")` gives a fee for a date that has not happened. The function has no "today" to compare against. Is this intended? Adding `todayIso` (see F1) would also allow an upper bound.
- Existence probe: a member calling `returnLoan(db, olya, 3, …)` gets AccessDenied, while `returnLoan(db, olya, 99, …)` gets "no such loan", so a member can learn which loan ids exist. Loan rows carry no PII (member id, book id, dates), so impact looks low. Should both cases return AccessDenied?
- Test gap for R20: nothing covers a member returning with a late date or an impossible date. Each fix above should come with its own test.

## Verdict
BLOCK
Reason: gate passed, but F1 and F2 are findings with Blocks: yes (R20).
