# Review: PR h2 — Кількість книжок на руках у довіднику учасників

## Gate
```
GATE PASSED — 0 block(s), 0 warning(s); tests: tests 14, pass 14, fail 0; checks: G0–G14
```

## Findings
### F1 — `listMembers` runs a full `db.loans` scan for every member (O(members × loans))
- Rule: R21 (Без регресії складності) · Severity: medium · Blocks: yes
- Where: app/src/members.js:11 (post-change line)
- Quote: `activeLoans: db.loans.filter((l) => l.memberId === id && l.returnedAt === null).length,`
- Failure scenario: base `listMembers` did one pass over `db.members`. Now each member row triggers a full pass over `db.loans`. With 10,000 members and 200,000 loans (years of history), one staff-desk call does about 2×10^9 predicate checks in a single synchronous call, where base did 10,000. The seed data (5 × 7) hides this. The base module already precomputes lookups for this pattern (`overdueReport` builds `names` as a Map once, then does O(1) reads per row).
- Fix: count once before the map, e.g. `const open = new Map(); for (const l of db.loans) if (l.returnedAt === null) open.set(l.memberId, (open.get(l.memberId) ?? 0) + 1);` and then `activeLoans: open.get(id) ?? 0`.

### F2 — Changed API list `listMembers` is still unpaginated
- Rule: R10 (Списки, що ростуть без меж, — сторінкові) · Severity: medium · Blocks: yes
- Where: app/src/members.js:7 (post-change line)
- Quote: `return db.members.map(({ id, name, role }) => ({`
- Failure scenario: the members list grows without bound. The function's return shape is changed by this PR, so the standard treats it as a changed API list. A call with 20,000 members returns all 20,000 rows, each now with a loan count, in one response. The base was already unpaginated, so this is not a new defect, but R10 applies to changed API lists and the PR touches this one.
- Fix: add `page` and `pageSize` parameters with a capped page size (e.g. max 100) and a CHANGELOG entry for the new parameters in the same PR.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| `listMembers` now also returns `activeLoans` | Yes | app/src/members.js:11 (`activeLoans` key in the returned row) |
| Test on row keys was updated (one field added) | Yes | test/members.test.js diff: `Object.keys(rows[0]).sort()` now expects `["activeLoans", "id", "name", "role"]` |
| New test with exact numbers on seeded data | Yes | test/members.test.js diff: `[[1, 1], [2, 1], [3, 0], [4, 0], [5, 2]]`; matches open loans in src/db.js (ids 2, 3, 5, 6). Gate test run passed 14/14. |
| CHANGELOG entry exists | Yes | app/CHANGELOG.md, new `## 2026-10` section listing `listMembers` rows gaining `activeLoans` |

Other checks, no finding: `activeLoans` is a count, so R4/R5 (PII, explicit fields) do not apply. The staff-only `requireRole` check is unchanged. The `returnedAt === null` test matches how `listLoans`, `borrow` and `overdueReport` treat open loans.

## Questions / could not verify
- Runtime cost at realistic data sizes is inferred from the code, not measured. Only the gate was run, per the scope rules.

## Verdict
BLOCK
Reason: gate passed, but blocking findings F1 (R21) and F2 (R10) are present.
