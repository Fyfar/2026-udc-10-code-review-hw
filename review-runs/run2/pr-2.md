# Review: PR 2 — Email учасника у звіті про прострочення

## Gate
```
BLOCK G5  app/src/loans.js overdueReport()  reads email/phone without logAccess(db, user, memberId, purpose)
BLOCK G6  app/src/loans.js:58  money formatted/converted in src/ — return integer …Kopecks, the client formats
BLOCK G6  app/src/loans.js:58  money field "feeText" must be integer kopecks named …Kopecks
GATE BLOCKED — 3 block(s), 0 warning(s); tests: tests 13, pass 13, fail 0; checks: G0–G14
```

## Findings
### F1 — Email returned in the overdue report with no access-log entry (gate G5 blocks; fix must log per member)
- Rule: R4 (Email і телефон → logAccess) · Severity: high · Blocks: yes
- Where: app/src/loans.js:54 (`email` field; the `member`/`email` lookups are at lines 53–54)
- Quote: `email: db.findMember(l.memberId)?.email ?? null,`
- Failure scenario: `overdueReport(createDb(), iryna, "2026-10-08")` returns rows for loans 6, 3 and 2 with the emails of marko@, taras@ and olya@example.invalid, and `db.accessLog` stays empty, so the team's "who looked at my data and why" record misses this read. The PR's "staff-only, so email is fine" argument does not exempt it: team-conventions §2 has no staff exemption. The block itself comes from G5; this finding adds the judgement the gate cannot see.
- Fix: after building the rows, call `logAccess(db, user, m.id, "overdue-report")` once per distinct member returned (not once per loan row, which would log the same member twice for two overdue loans), and skip members that are null.

### F2 — Return shape changed without a CHANGELOG entry
- Rule: R9 (CHANGELOG for public-function shape changes) · Severity: high · Blocks: yes
- Where: app/src/loans.js:53–58 (new keys `email`, `feeText`); app/CHANGELOG.md:8–9 (not updated by this PR)
- Quote: `email: db.findMember(l.memberId)?.email ?? null,` / `feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",`
- Failure scenario: `overdueReport(createDb(), iryna, "2026-10-08")` now returns rows with keys `email` and `feeText`. CHANGELOG.md lines 8–9 still list only `loanId`, `member`, `book`, `daysLate`, `feeKopecks`, so a consumer or reviewer working from the changelog does not know that personal data now flows out of this report. The gate's G3 did not fire because no `export` line changed; this is a body-level shape change, which R9 covers.
- Fix: add `email` and `feeText` to the 2026-09 `overdueReport` entry in app/CHANGELOG.md in this same PR.

### F3 — Money returned as a display string from src/
- Rule: R7 (Гроші — лише копійки) · Severity: medium · Blocks: yes
- Where: app/src/loans.js:58
- Quote: `feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",`
- Failure scenario: a row for loan 2 now carries `feeKopecks: 7000` and `feeText: "70,00 грн"`. The display format (decimal comma, "грн") is decided in src/, so a client that shows another currency or locale has to ask for an API change. The gate's G6 already blocks this; the judgement part is that the whole field is a presentation concern, not data.
- Fix: delete the `feeText` line. The client formats `feeKopecks` (team-conventions §4).

### F4 — Per-row linear lookups replace the O(1) Map lookup
- Rule: R21 (Без регресії складності) · Severity: medium · Blocks: yes
- Where: app/src/loans.js:53–54 (base line 49 built `names` once; `db.findMember` at app/src/db.js:41–43 is `members.find`)
- Quote: `member: db.findMember(l.memberId)?.name ?? "—",` / `email: db.findMember(l.memberId)?.email ?? null,`
- Failure scenario: with 20,000 members and 20,000 overdue loans, each row runs two `members.find` scans (about 10,000 comparisons each on average), roughly 4×10^8 comparisons per report. The base code did one 20,000-entry Map build and 20,000 Map lookups. Seed data hides this, but the list grows with members and loans.
- Fix: restore the base pattern and keep one lookup per row: `const members = new Map(db.members.map((m) => [m.id, m]));` once, then `const m = members.get(l.memberId);` in the row mapper, using `m?.name` and `m?.email`.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| "Для кожного рядка беремо учасника і віддаємо ім'я та email" (for each row we take the member and return name and email) | Yes | app/src/loans.js:53–54: `member` (name) and `email` are set for every returned row |
| "Звіт і так лише для персоналу" (the report is staff-only anyway) | Yes | app/src/loans.js:48 `requireRole(user, STAFF)`, unchanged base line |
| "email тут доречний" (email is appropriate here) | Not a code claim; a justification, so R13 does not apply | Team-conventions §2 requires logAccess for any function that returns email, with no staff exemption. See F1. |

PR.md does not mention `feeText` or the new return keys. Per R13 that is judged by its own rule (F2, F3), not as a description mismatch.

## Questions / could not verify
- `overdueReport` returns an unpaginated list that grows with loans (R10). The base code is also unpaginated and the PR does not change the list's size, so this is not a finding here. Is the weekly reminder list expected to stay small, or should it be paged?
- PR.md's "staff-only, so email is appropriate" is a justification, not an instruction to skip a check, so it is not an R14 finding. It does not exempt R4 (see F1).
- Gate tests pass (13/13), and the test change adds a concrete `email` assertion for `rows[0]`. No test covers `feeText`; it should be removed under F3 rather than tested.

## Verdict
BLOCK
Reason: gate BLOCKED (G5, G6 ×2); blocking findings F1, F2, F3, F4.
