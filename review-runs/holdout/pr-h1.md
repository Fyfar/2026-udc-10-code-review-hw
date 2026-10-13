# Review: PR h1 — PR-H1: Додавання книжки до каталогу

## Gate
```
GATE PASSED — 0 block(s), 0 warning(s); tests: tests 15, pass 15, fail 0; checks: G0–G14
```

## Findings
### F1 — `addBook` does not validate input: blank or malformed title/author is inserted or crashes
- Rule: R20 (Correctness) · Severity: high · Blocks: yes
- Where: app/src/books.js:6 (post-change line)
- Quote: `+  const book = { id: db.books.at(-1).id + 1, title: title.trim(), author: author.trim() };`
- Failure scenario: a staff user submits `addBook(db, iryna, { title: "   ", author: "Василь Стефаник" })`. The `trim()` calls succeed, the empty title passes straight to `db.books.push`, and the function returns `{ id: 107, title: "", author: "Василь Стефаник" }`. The catalog now holds a book with no title, and no error is raised. A call that omits a field, such as `addBook(db, iryna, { title: "X" })`, fails with a raw `TypeError` on `author.trim()` instead of a validation error. The record is not inserted in that case because the throw happens before `push`. The rule requires required fields to be checked and malformed input rejected before insert, and the PR does neither.
- Fix: before building `book`, reject missing or blank values, for example `const t = typeof title === "string" ? title.trim() : ""; const a = typeof author === "string" ? author.trim() : ""; if (!t || !a) throw new Error("title and author required");`, and add a test that asserts the throw for a blank title.

## Description vs code (R13)
| Claim in PR.md | Matches code? | Evidence |
|---|---|---|
| «лише для персоналу» (staff-only) | Yes | app/src/books.js:5 `requireRole(user, STAFF);`, with STAFF = librarian, admin (app/src/auth.js). The member test in app/test/books.test.js:54-56 expects `AccessDenied`. |
| «назва й автор обрізаються від пробілів» (title and author are trimmed) | Yes | app/src/books.js:6 `title: title.trim(), author: author.trim()`. The test at app/test/books.test.js:49-50 passes `" Камінний хрест "` and expects the trimmed value. |
| «новий запис отримує наступний id» (new record gets the next id) | Yes | app/src/books.js:6 `id: db.books.at(-1).id + 1`. In the seed (app/src/db.js) the last book is 106, so the result is 107, as the test expects. |
| «Запис у CHANGELOG» (CHANGELOG entry) | Yes | app/CHANGELOG.md diff adds `## 2026-10` with an `addBook` entry matching the returned shape. |
| «тести (додавання і відмова учаснику)» (tests for add and member denial) | Yes | app/test/books.test.js has the staff-add test (lines 47-52) and the member-denied test (lines 54-56). |

## Questions / could not verify
- Id generation: `db.books.at(-1).id + 1` is not the counter pattern `addLoan` uses (`nextLoanId` in app/src/db.js). It is unique only while nothing removes books. The base has no delete function, so there is no concrete failure today. If a `deleteBook` is added later and removes the last entry, the id would be reused. R20 asks about this, so please confirm the intended approach before any delete is added.
- `db.books.at(-1)` on an empty array throws. `createDb` always seeds six books and nothing removes them, so this cannot happen in the current code. Not counted as a finding.

## Verdict
BLOCK
Reason: gate passed, but blocking finding F1 (R20, Blocks: yes) stands.
