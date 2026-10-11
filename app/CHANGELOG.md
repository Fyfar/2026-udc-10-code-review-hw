# Changelog

Every change to what a public function in `src/` accepts or returns gets an entry
here in the same pull request (see `docs/team-conventions.md`).

## 2026-10

- `lateFee` — the first day late is free (library policy from 1 November).

## 2026-09

- `overdueReport(db, user, todayIso)` — staff-only report of loans past due, with
  `loanId`, `member`, `book`, `daysLate`, `feeKopecks`.
- `memberCard` records each read in the access log (`src/audit.js`).

## 2026-08

- `listLoans`, `borrow`, `lateFee`, `listMembers`, `memberCard` — first release.
