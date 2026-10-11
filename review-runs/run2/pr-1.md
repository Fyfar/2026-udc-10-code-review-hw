# Review: PR 1 — Сторінкування для списку позик

## Gate
```
BLOCK G3  app/src/loans.js  exported API changed but app/CHANGELOG.md has no entry in this diff
GATE BLOCKED — 1 block(s), 0 warning(s); tests: tests 14, pass 14, fail 0; checks: G0–G14
```

## Findings
### F1 — listLoansPage skips the first page: offset is page * pageSize, but page is 1-based
- Rule: R20 (Correctness) · Severity: high · Blocks: yes
- Where: app/src/loans.js:32
- Quote: `  const start = page * pageSize;` and `  return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length };` (app/src/loans.js:33)
- Failure scenario: `page` defaults to 1 and is echoed back as a 1-based page. Staff call `listLoansPage(db, iryna, { page: 1, pageSize: 3 })` on the 7 seeded loans: `start = 3`, so `items` is loans #4, #5, #6, and loans #1–#3 are never returned on page 1. With 45 loans, page 1 returns #21–#40, page 2 returns #41–#45, page 3 is empty, and #1–#20 never appear on any page. With the default size on the seed data, page 1 returns `items: []` while `total: 7`.
- Fix: `const start = (page - 1) * pageSize;`

### F2 — pageSize is not capped, so one request can still return the whole table
- Rule: R10 (Growing lists are paginated with a capped size) · Severity: medium · Blocks: yes
- Where: app/src/loans.js:30
- Quote: `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {`
- Failure scenario: a caller passes `{ pageSize: 100000 }`; the function returns all 3 000+ loans in one response, which is the slowness this PR is meant to fix. `page` and `pageSize` are not validated either: `pageSize: 0` or `page: -1` silently returns `items: []` with no error.
- Fix: clamp the size, e.g. `const size = Math.min(Math.max(1, Math.trunc(pageSize)), 100);`, use `size` in both `slice` and the return value, and reject `page < 1`.

### F3 — the new test does not check the returned items, so F1 passes it
- Rule: R11 (Tests pin concrete results) · Severity: medium · Blocks: yes
- Where: app/test/loans.test.js:17
- Quote: `  assert.equal(res.total, 7);`
- Failure scenario: with F1 present, `res.total`, `res.page` and `res.pageSize` are all still correct, so the test passes. Nothing checks which loans come back.
- Fix: call with `{ page: 1, pageSize: 3 }` and add `assert.deepEqual(res.items.map((l) => l.id), [1, 2, 3]);`. This fails on the current code (it gets [4, 5, 6]) and passes once F1 is fixed.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| "Додав `listLoansPage`" (added listLoansPage) | Yes | Exported at app/src/loans.js:30 |
| "сторінки, розмір сторінки, загальна кількість" (pages, page size, total) | Fields yes; page navigation no | Returns `page`, `pageSize`, `total` (loans.js:33). Wrong page offset is F1 (R20), not a separate R13 finding |
| "Старий `listLoans` не чіпав" (did not touch old listLoans) | Yes | Diff hunk `@@ -26,6 +26,13 @@` only adds code after listLoans; its body is unchanged |
| "щоб нічого не зламати" (so nothing breaks) | Yes | Change is additive; listLoans signature and behaviour unchanged |
| "Тест додав" (added a test) | Yes, but weak | app/test/loans.test.js:15–20 asserts total, page and pageSize only (F3) |
| "Список позик для персоналу" (loan list for staff) | Purpose only | listLoansPage has no staff check; it delegates to listLoans, which returns all loans to staff and only the caller's own loans to members (app/src/loans.js:23–26). No leak; R2 holds |
| "вже на 3 000+ рядків" (already 3 000+ rows) | Cannot verify | Not in the repo; seed data has 7 loans |

## Questions / could not verify
- Is listLoansPage meant to be staff-only? The comment says "for the staff UI", but members can call it and get only their own loans, same as listLoans. If staff-only is intended, add `requireRole(user, STAFF)` as overdueReport does; otherwise drop "for staff" from the comment. Not a finding: no data leaks.
- Does paging fix the UI slowness? listLoans still copies every loan (`{ ...l }`) on each page request, so server work stays O(n) per page; only the payload shrinks. The 3 000-row case cannot be measured from this repo.
- No test checks that a member sees only their own rows through listLoansPage. R12 does not require it (the function has no own check), but it would pin R2 for the new export.

## Verdict
BLOCK
Reason: gate BLOCKED (G3: no CHANGELOG entry for the new export); blocking findings F1, F2, F3.
