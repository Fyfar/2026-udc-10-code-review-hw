# Review: PR 3 — Експорт учасників у CSV

## Gate
```
BLOCK G5  app/src/members.js exportMembersCsv()  touches email/phone without logAccess(db, user, memberId, purpose)
BLOCK G5  app/src/members.js exportMembersCsv()  spreads an object in a function that reads members — return explicit fields (PII leak risk)
GATE BLOCKED — 2 block(s), 0 warning(s); tests: tests 15, pass 15, fail 0; checks: G0–G14
```

## Findings
### F1 — Any signed-in member can export every member's email and phone
- Rule: R1 (role check on data-returning function) · Severity: critical · Blocks: yes
- Where: app/src/members.js:12 (post-change line)
- Quote: `if (!user) throw new AccessDenied();`
- Failure scenario: `exportMembersCsv(db, olya)` with `olya = { id: 1, role: "member" }` (the test file's own member fixture) does not throw and returns a CSV with `email` and `phone` for all 5 members, e.g. `2,Тарас Приклад,taras@example.invalid,+380000000002,member`. The only check is that `user` is truthy. The directory is staff-only in `listMembers` (members.js:6, `requireRole(user, STAFF)`), and this export contains the same data. Gate G4 passes because a null check counts as "a role check"; this is the case the gate cannot see. The same line also violates R2 (a member reads others' data), and the same fix resolves it.
- Fix: replace line 12 with `requireRole(user, STAFF);` (`requireRole` and `STAFF` are already imported on line 1). Members are not staff, so no per-row ownership check is needed.

### F2 — Export returns email and phone with no access-log entry
- Rule: R4 (logAccess for email/phone) · Severity: high · Blocks: yes
- Where: app/src/members.js:14
- Quote: `const lines = db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role].join(","));`
- Failure scenario: `exportMembersCsv(db, iryna)` on the 5-member seed returns 5 rows with email and phone, and `db.accessLog` gets 0 new entries. Gate G5 (first BLOCK) already flags the missing call. The judgement point: the team's record of "who looked at my data" (team-conventions §2) is empty for the whole export, where `memberCard` writes one entry per member (members.js:16).
- Fix: before building `lines`, add `for (const m of db.members) logAccess(db, user, m.id, "monthly-reconciliation");`. This runs only after the role check (F1), so refused calls log nothing.

### F3 — CSV fields are not quoted, so a comma or line break in a name shifts the columns
- Rule: R20 (correctness on edge data) · Severity: high · Blocks: yes
- Where: app/src/members.js:14
- Quote: `[m.id, m.name, m.email, m.phone, m.role].join(",")`
- Failure scenario: a member named `Коцюбинський, Михайло` produces the row `6,Коцюбинський, Михайло,<email>,<phone>,member`: six fields under a five-column header. Under the header, the email lands in the `email` column as ` Михайло`, the real email moves into `phone`, the phone into `role`, and `member` is left over. A name containing a line break also breaks `csv.split("\n")`, so the row count is wrong.
- Fix: quote every field with one helper, e.g. `const q = (v) => \`"${String(v ?? "").replace(/"/g, '""')}"\`;`, and use `.map(q).join(",")` in place of the bare `.join(",")`.

### F4 — Unbounded list: every member in one response
- Rule: R10 (paginated lists) · Severity: medium · Blocks: yes
- Where: app/src/members.js:14–15
- Quote: `const lines = db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role].join(","));` / `return [header, ...lines].join("\n");`
- Failure scenario: with 50,000 members, one call builds the whole CSV string in memory and returns it in one response, with no page size or cap. `members` is one of the lists team-conventions §7 names as growing without limit.
- Fix: accept a page (`offset`, and `limit` with a fixed cap such as 1000) and slice `db.members` before mapping. The new parameters change the signature, so add a CHANGELOG line (R9).

### F5 — The denial test uses an anonymous caller, so a member can read the export and the suite stays green
- Rule: R12 (denial test for a new access-checked function) · Severity: medium · Blocks: yes
- Where: app/test/members.test.js:43–45
- Quote: `assert.throws(() => exportMembersCsv(createDb(), null), AccessDenied);`
- Failure scenario: the code from F1 passes all 15 tests. A member calling `exportMembersCsv(createDb(), olya)` gets the data with no error, because the only denial case is `null`. The existing `memberCard` tests check denial for a member (test/members.test.js:23).
- Fix: add `assert.throws(() => exportMembersCsv(createDb(), olya), AccessDenied);` (`olya` is already defined on line 7). This assertion fails against the current code, which is the point.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| «експорт учасників у CSV: ім'я, email, телефон, роль» | Mostly. The code also adds an `id` column, which is not claimed | members.js:13–15 |
| «Додав `exportMembersCsv`» | Yes | members.js:11 |
| «Без користувача — відмова, як і скрізь» | Yes for a missing user: members.js:12 throws the same way as `memberCard`. The role check that the neighbouring functions do is missing (F1) | members.js:12 |
| «Тест на формат файлу додав» | Partly. The test checks the header and row count only, not field values or quoting (F3) | test/members.test.js:36–41 |

## Questions / could not verify
- Gate G5 also flags a spread in `exportMembersCsv`. The token is `...lines` on members.js:15, an array of CSV strings. I found no member object returned whole (R5). The gate result stands as emitted.
- Who is meant to run this export? PR.md does not say. The F1 fix assumes staff only; the author should confirm.
- Whether bulk export of contact details is allowed by library policy cannot be checked from code.

## Verdict
BLOCK
Reason: gate BLOCKED (G5 ×2) and blocking findings F1–F5.
