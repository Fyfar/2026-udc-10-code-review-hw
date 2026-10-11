# Review: PR 1 — Сторінкування для списку позик

## Gate
BLOCK G3  app/src/loans.js  exported API changed but app/CHANGELOG.md has no entry in this diff
BLOCK G4  app/src/loans.js listLoansPage()  takes db but never checks the caller (requireRole / isStaff / AccessDenied)
GATE BLOCKED — 2 block(s), 0 warning(s); tests: tests 14, pass 14, fail 0; checks: G0–G14

## Findings
### F1 — listLoansPage skips the first page: `start = page * pageSize` with 1-based default page
- Rule: R20 (Коректність) · Severity: high · Blocks: yes
- Where: app/src/loans.js:32 (post-change line)
- Quote: `  const start = page * pageSize;`
- Failure scenario: staff UI calls `listLoansPage(db, iryna)` (defaults `page = 1`, `pageSize = 20`) → `start = 20`, so `items` is loans #21–40 (zero-based indices 20–39). Indices 0–19 are never returned by any page ≥ 1 (page p covers `[p*20, p*20+20)`), so the first 20 loans are unreachable with 1-based paging. With the 7 seed loans, page 1 returns `items: []` while `total: 7`. Page 0 returns the first 20 rows, so the two ends of the paging disagree.
- Fix: `const start = (page - 1) * pageSize;` (and reject `page < 1` / non-integers, see F3), or document and use 0-based pages consistently.

### F2 — New public export and changed return shape with no CHANGELOG entry
- Rule: R9 (публічна зміна → CHANGELOG) · Severity: high · Blocks: yes
- Where: app/src/loans.js:30 (post-change line); app/CHANGELOG.md not touched
- Quote: `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {`
- Failure scenario: a new public function returning `{ items, page, pageSize, total }` ships; `app/CHANGELOG.md` (latest heading `## 2026-09`) has no entry, so consumers of `src/` are not told it exists or what it returns. Gate G3 confirms the gap.
- Fix: add an entry to `app/CHANGELOG.md` in this PR, e.g. "`listLoansPage(db, user, { page, pageSize })` — staff-facing paged list of loans: `{ items, page, pageSize, total }`."

### F3 — pageSize is uncapped, so pagination can be bypassed
- Rule: R10 (сторінкові списки) · Severity: medium · Blocks: yes
- Where: app/src/loans.js:33 (post-change line), signature at :30
- Quote: `  return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length };`
- Failure scenario: a caller passes `pageSize: 100000` (or `page: -1`, which gives `start = -20`, `slice(-20, 0)` → `[]` silently). With 3 000+ loans, one call returns the entire list, the same payload the PR is meant to avoid. No `Math.min` cap or integer check exists anywhere in the function.
- Fix: clamp the size, e.g. `const size = Math.min(Math.max(1, Math.floor(pageSize)), 100);` and clamp `page` to `>= 1`.

### F4 — The new test does not check the returned items, so F1 passes it
- Rule: R11 (тест перевіряє конкретний результат) · Severity: medium · Blocks: yes
- Where: app/test/loans.test.js:17–19 (post-change lines)
- Quote: `  assert.equal(res.total, 7);` / `  assert.equal(res.page, 1);` / `  assert.equal(res.pageSize, 20);`
- Failure scenario: `items` is never asserted. The function returns `items: []` for page 1 (F1) and the test still passes. No test covers a second page or a boundary (last partial page, `total` 0).
- Fix: assert the rows, e.g. `assert.deepEqual(res.items.map((l) => l.id), [1, 2, 3, 4, 5, 6, 7]);` for page 1, plus `listLoansPage(createDb(), iryna, { page: 2, pageSize: 3 })` → ids `[4, 5, 6]`.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| "Список позик для персоналу вже на 3 000+ рядків, у UI все гальмує" (motivation) | Not verified | Every page call still builds and copies the full list before slicing: app/src/loans.js:31 (`const all = listLoans(db, user)`), listLoans copy at :26. Paging shrinks the response, not the server work. |
| "Додав `listLoansPage`" | Yes | app/src/loans.js:30 |
| "сторінки" (pages) | No | Page 1 returns indices 20–39; the first 20 loans are unreachable by page ≥ 1 (F1). |
| "розмір сторінки" (page size) | Partly | `pageSize` is accepted (app/src/loans.js:30) but not capped (F3). |
| "загальна кількість" (total) | Yes | `total: all.length`, app/src/loans.js:33; asserted as 7 at app/test/loans.test.js:17. |
| "Старий `listLoans` не чіпав" | Yes | Diff hunk `@@ -26,6 +26,13 @@` only adds after `listLoans`; its body (app/src/loans.js:23–27) is unchanged. |
| "Тест додав." | Yes, but weak | app/test/loans.test.js:15–20; checks total/page/pageSize, not items (F4). |

## Questions / could not verify
- G4 (listLoansPage has no role check of its own): the gate block stands and is not disputed. For the record, judgement: `listLoansPage` delegates to `listLoans`, which throws on a missing user and filters non-staff to their own loans (app/src/loans.js:23–26), so no data leak was found. G4 cannot see delegation.
- The description says "для персоналу" (for staff). The function has no `requireRole(user, STAFF)` like `overdueReport`; a member gets their own loans through it. Is staff-only intended? If yes, this is an R1 role-set question for the author.
- Performance motivation: server-side cost is unchanged (full array built and copied per call). Whether the UI slowdown is actually fixed was not verified.
- No test covers a member calling `listLoansPage`; the scoping relies on `listLoans`.
- The bug in F1 was derived by hand from the arithmetic and the 7 seed loans; the tests were not executed (npm test is not permitted for this review).
- PR.md was not scanned for invisible or bidi characters with a dedicated check. G10 covers only added lines under app/, and it passed.

## Verdict
BLOCK
Reason: gate BLOCKED (G3, G4) and blocking findings F1, F2, F3, F4 (R20, R9, R10, R11 all "блокує").
