import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/db.js";
import { listLoans, borrow, lateFee, overdueReport, addDays, daysBetween, LOAN_DAYS } from "../src/loans.js";
import { AccessDenied } from "../src/auth.js";

const olya = { id: 1, role: "member" };
const iryna = { id: 3, role: "librarian" };

test("a member sees only their own loans", () => {
  const rows = listLoans(createDb(), olya);
  assert.deepEqual(rows.map((l) => l.id), [1, 2, 7]);
});

test("staff see every loan", () => {
  assert.equal(listLoans(createDb(), iryna).length, 7);
});

test("borrowing sets the due date LOAN_DAYS after the day it was taken", () => {
  const db = createDb();
  const loan = borrow(db, olya, { bookId: 101, takenAt: "2026-10-01" });
  assert.equal(LOAN_DAYS, 14);
  assert.equal(loan.dueAt, "2026-10-15");
  assert.equal(loan.memberId, 1);
});

test("a book that is out cannot be borrowed again", () => {
  assert.throws(() => borrow(createDb(), olya, { bookId: 102, takenAt: "2026-10-01" }), /already out/);
});

test("date helpers work across month ends", () => {
  assert.equal(addDays("2026-09-25", 14), "2026-10-09");
  assert.equal(daysBetween("2026-09-24", "2026-10-08"), 14);
});

test("late fee: 5 грн per day late, nothing when on time", () => {
  const db = createDb();
  const returnedLate = db.loans.find((l) => l.id === 4); // due 10-04, returned 10-07
  const onTime = db.loans.find((l) => l.id === 1); // due 09-15, returned 09-14
  assert.ok(lateFee(returnedLate, "2026-10-08") > 0);
  assert.equal(lateFee(onTime, "2026-10-08"), 0);
});

test("overdue report lists loans still out past due, most overdue first", () => {
  const rows = overdueReport(createDb(), iryna, "2026-10-08");
  assert.deepEqual(rows.map((r) => r.loanId), [6, 3, 2]);
  assert.equal(rows[0].member, "Марко Приклад");
  assert.equal(rows[0].daysLate, 22);
  assert.ok(rows[0].feeKopecks > 0);
});

test("the overdue report is staff-only", () => {
  assert.throws(() => overdueReport(createDb(), olya, "2026-10-08"), AccessDenied);
});
