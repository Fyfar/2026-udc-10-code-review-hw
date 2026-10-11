# Review: PR 3 — Експорт учасників у CSV

## Gate
```
BLOCK G5  app/src/members.js exportMembersCsv()  reads email/phone without logAccess(db, user, memberId, purpose)
GATE BLOCKED — 1 block(s), 0 warning(s); tests: tests 15, pass 15, fail 0; checks: G0–G14
```

## Findings
### F1 — exportMembersCsv checks only that a user exists, so any logged-in member can export every member's email and phone
- Rule: R1 (Кожна функція, що віддає дані, перевіряє роль) · Severity: critical · Blocks: yes
- Where: app/src/members.js:11-12
- Quote: `export function exportMembersCsv(db, user) {` / `if (!user) throw new AccessDenied();`
- Failure scenario: Olya (`{ id: 1, role: "member" }`) calls `exportMembersCsv(createDb(), olya)`. The `!user` check passes and she gets a CSV with the email and phone of all five members. Neighbouring `listMembers` (members.js:6) uses `requireRole(user, STAFF)`, and `overdueReport` does the same. This is also an R2 violation (a member reads others' contact data); it is the same defect, so it is reported once here.
- Fix: replace line 12 with `requireRole(user, STAFF);` (`requireRole` and `STAFF` are already imported in members.js). Add a test that `exportMembersCsv(createDb(), olya)` throws `AccessDenied`. The existing test only covers a `null` caller, so it does not catch this.

### F2 — email and phone are returned without any logAccess record
- Rule: R4 (Email і телефон → logAccess, один запис на учасника) · Severity: high · Blocks: yes. Gate G5 is the mechanical signal of this same defect (referenced by ID, not re-listed).
- Where: app/src/members.js:14
- Quote: `const lines = db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role].join(","));`
- Failure scenario: Iryna (librarian) runs the export. Five members' emails and phones are returned and `db.accessLog` gets no new entries. Team convention §2 requires exactly this read to be recorded, as `memberCard` does, so nobody can later answer "who looked at my data and why".
- Fix: inside the `map`, call `logAccess(db, user, m.id, "monthly-reconciliation")` for each member before returning the row (`logAccess` is already imported at members.js:2). Add a test that asserts one `accessLog` entry per member with the expected purpose.

### F3 — CSV cells are joined with bare commas and no quoting, so a name containing a comma shifts every later column
- Rule: R20 (Коректність) · Severity: high · Blocks: yes
- Where: app/src/members.js:14
- Quote: `.join(",")` on the same line as above.
- Failure scenario: a member whose name is `Коваль, Олена` (names are free text; the seed data simply has no commas) produces the row `5,Коваль, Олена,marko@example.invalid,+380000000005,member`. That is six fields under a five-column header, so in the reconciliation sheet the phone lands under "email" and the role under "phone". A name containing a double quote or a newline breaks the row in the same way.
- Fix: quote every cell, e.g. a one-line helper `const cell = (v) => \`"${String(v ?? "").replaceAll('"', '""')}"\`;` and `.map(cell).join(",")` on the row. Add a test with a comma in a name.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| «Додав `exportMembersCsv`» (added `exportMembersCsv`) | Yes | members.js:11 exports it; CHANGELOG entry added under 2026-10 |
| «Без користувача — відмова, як і скрізь» (no user means refusal, as everywhere) | Yes | members.js:12 `if (!user) throw new AccessDenied();`, same as memberCard (members.js:12). The "as everywhere" wording is loose (listLoans and borrow throw a plain `Error`), but the claim about refusal is true, so not R13. |
| «Тест на формат файлу додав» (added a test on the file format) | Partly | test lines 53–58 check the header and the line count (6 = header + 5 rows). They do not check cell values or escaping (see F3). The claim is literally true, so not R13. |
| Columns «ім'я, email, телефон, роль» (name, email, phone, role) | Yes, plus an `id` column | header `id,name,email,phone,role`. The PR lists four columns and does not say `id` is excluded, so not R13. |

The PR says nothing about who may run the export or about access logging. That is not an R13 finding (the standard says so). Those gaps are judged under R1 and R4 (F1, F2).

## Questions / could not verify
- R10 (question only, not a finding): the export returns the whole membership with no page size. Per the standard, a file export whose purpose is the full set is not a paginated API list. Confirm that this is only a download and that no UI or API route calls it to page through members. The directory is five members today, so growth is the concern.
- Not covered by any rule in the standard, so not reported: CSV formula injection. A name or email starting with `=`, `+`, `-` or `@` would be evaluated as a formula when the file is opened in a spreadsheet. The team may want a rule for this.
- The gate's G9 check is satisfied by the existing null-caller test. The test gap for F1 and F2 is noted in those findings' fixes.

## Verdict
BLOCK
Reason: gate BLOCKED (G5), and blocking findings F1, F2 and F3.
