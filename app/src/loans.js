import { isStaff, requireRole, STAFF } from "./auth.js";

export const LOAN_DAYS = 14;
export const FEE_PER_DAY_KOPECKS = 500; // 5 грн за кожен день прострочення
export const GRACE_DAYS = 1; // політика з 1 листопада: перший день прострочення безкоштовний

// --- date helpers (YYYY-MM-DD strings, UTC) ---------------------------------

function toUtc(iso) {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

export function daysBetween(fromIso, toIso) {
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86_400_000);
}

export function addDays(iso, days) {
  return new Date(toUtc(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

// --- loans -----------------------------------------------------------------

/** Staff see every loan; a member sees only their own. */
export function listLoans(db, user) {
  if (!user) throw new Error("user required");
  const rows = isStaff(user) ? db.loans : db.loans.filter((l) => l.memberId === user.id);
  return rows.map((l) => ({ ...l }));
}

export function borrow(db, user, { bookId, takenAt }) {
  if (!user) throw new Error("user required");
  if (!db.findBook(bookId)) throw new Error("no such book");
  const out = db.loans.find((l) => l.bookId === bookId && l.returnedAt === null);
  if (out) throw new Error("book is already out");
  return db.addLoan({ memberId: user.id, bookId, takenAt, dueAt: addDays(takenAt, LOAN_DAYS) });
}

/** Late fee in kopecks for a loan returned (or still out) on `onIso`. */
export function lateFee(loan, onIso) {
  const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso) - GRACE_DAYS;
  return late > 0 ? late * FEE_PER_DAY_KOPECKS : 0;
}

/**
 * Staff-only report: every loan still out past its due date, with the
 * member's name. Built for the weekly reminder calls.
 */
export function overdueReport(db, user, todayIso) {
  requireRole(user, STAFF);
  const names = new Map(db.members.map((m) => [m.id, m.name]));
  return db.loans
    .filter((l) => l.returnedAt === null && l.dueAt < todayIso)
    .map((l) => ({
      loanId: l.id,
      member: names.get(l.memberId) ?? "—",
      book: db.findBook(l.bookId)?.title ?? "—",
      daysLate: daysBetween(l.dueAt, todayIso),
      feeKopecks: lateFee(l, todayIso),
    }))
    .sort((a, b) => b.daysLate - a.daysLate);
}
