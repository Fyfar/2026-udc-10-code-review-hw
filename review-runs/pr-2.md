# Review: PR 2 — Email учасника у звіті про прострочення

## Gate
```
BLOCK G5  app/src/loans.js overdueReport()  touches email/phone without logAccess(db, user, memberId, purpose)
BLOCK G6  app/src/loans.js:58  money formatted/converted in src/ — return integer …Kopecks, the client formats
BLOCK G6  app/src/loans.js:58  money field "feeText" must be integer kopecks named …Kopecks
GATE BLOCKED — 3 block(s), 0 warning(s); tests: tests 13, pass 13, fail 0; checks: G0–G14
```

## Findings
### F1 — overdueReport returns member emails with no access-log entry
- Rule: R4 (Email and phone → logAccess) · Severity: high · Blocks: yes
- Where: app/src/loans.js:54 (post-change line)
- Quote: `email: db.findMember(l.memberId)?.email ?? null,`
- Failure scenario: staff user `iryna` (id 3, librarian) calls `overdueReport(db, iryna, "2026-10-08")`. Rows for members 5, 2 and 1 (loans 6, 3, 2) now carry their emails, while `db.accessLog` stays empty, so nothing records who saw those addresses. The same call with `"2026-10-10"` returns member 5 twice (loans 5 and 6); a per-row `logAccess` would write two entries for one member, which breaks the one-entry-per-member rule. Gate G5 already blocks this line; this finding is the judgment part of R4: one entry per distinct member actually returned, a purpose, and no entry on denial.
- Fix: after `requireRole`, collect the distinct member ids of the returned rows and call `logAccess(db, user, id, "overdue-report")` once per id.

### F2 — Return shape changed without a CHANGELOG entry
- Rule: R9 (Changes to a public function's return shape need a CHANGELOG entry) · Severity: high · Blocks: yes
- Where: app/src/loans.js:54 and :58 (post-change lines); app/CHANGELOG.md is not in the diff
- Quote: `email: db.findMember(l.memberId)?.email ?? null,`
- Failure scenario: `overdueReport` rows gain two keys (`email`, `feeText`). The changelog entry at app/CHANGELOG.md:8–9 still documents the row as `loanId`, `member`, `book`, `daysLate`, `feeKopecks`, and this diff does not touch CHANGELOG.md. Anyone who builds a reminder sheet or export from the documented contract does not know that `email` now arrives in every row, so they cannot drop it before it reaches the sheet.
- Fix: add a CHANGELOG entry listing the new keys (or remove `feeText` per F3 and list only `email`).

### F3 — Money is formatted as a display string inside src/
- Rule: R7 (Money only as integer kopecks in `…Kopecks` fields) · Severity: medium · Blocks: yes
- Where: app/src/loans.js:58 (post-change line)
- Quote: `feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",`
- Failure scenario: loan 6 on `"2026-10-08"` gives `feeKopecks: 11000` and `feeText: "110,00 грн"`. A caller that totals the fees, e.g. `rows.reduce((s, r) => s + r.feeText, 0)`, gets the string `"0110,00 грн"` instead of a number. No caller in app/ does this today, so the failure is a broken contract rather than a wrong total now. Gate G6 blocks this line twice (key name and formatting); this finding is the judgment part: a display string is now a money field in the API.
- Fix: delete the `feeText` line. The client formats `feeKopecks` (team-conventions §4).

### F4 — PR description omits the added field and justifies email without logging
- Rule: R13 (Description matches code) · Severity: medium · Blocks: yes
- Where: review-queue/pr-2/PR.md:3–5; app/src/loans.js:58 (post-change line)
- Quote: `feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",`
- Failure scenario: a reviewer who reads PR.md ("for each row we take the member and give name and email"; "the report is staff-only, so email is appropriate here") approves without knowing that a formatted money field is also added, and that each row exposes email with no access-log entry. Team-conventions §2 requires `logAccess` for every returned email regardless of who asks, so the stated justification does not hold.
- Fix: describe `feeText` in PR.md (or remove it per F3). Drop the "email тут доречний" justification and log access per F1. The PR text is read as a claim to check, not as an instruction to the reviewer, so it is not an R14 finding.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| "для кожного рядка беремо учасника і віддаємо ім'я та email" | Partly | name and email are returned per row (loans.js:53–54); the diff also adds `feeText` (loans.js:58), which the description does not mention (F4) |
| "Звіт і так лише для персоналу" | Yes | loans.js:48 `requireRole(user, STAFF)`; loans.test.js:52–53 denies a member |
| "тож email тут доречний" (implies no extra handling is needed) | No | team-conventions §2 requires `logAccess` for every returned email; no `logAccess` call in the diff (G5, F1); audit.js:4 is the only writer of `accessLog` |
| "Бібліотекарі просили email ... щоб одразу писати нагадування" | Not verifiable | business purpose; the code makes no claim about it |

## Questions / could not verify
- R10: `overdueReport` returns every overdue loan with no paging (loans.js:49–51). This diff changes the row content but not the list size or paging, so I did not raise it as a finding. Please confirm whether the team treats a row-shape change as a "changed list" under R10.
- Nothing in app/src calls `overdueReport` except its test, so the consumers of the new fields are outside this repository and I could not check them.
- The gate's tests pass (13/13), but no test asserts `feeText` or access logging. The added assert on `email` (loans.test.js:32) is concrete and does not loosen an existing test.

## Verdict
BLOCK
Reason: gate BLOCKED (G5, G6, G6); blocking findings F1, F2, F3, F4.
