// P2 review priority for one supplier invoice. Pure function: no I/O, easy to test and to explain.
// Priority answers "how much attention does this invoice need before the payment run?";
// the due date then decides the order WITHIN a level.
//
// Points (each signal is explained in plain words in `reasons`):
//   HOLD  supplier on payment hold in P4 (bank details just changed) ..... 60  -> High on its own
//   D1    possible duplicate (same party, amount, currency within 30 days) 60  -> High on its own
//   CHG   supplier master data changed in P4 in the last 30 days ......... 30, +10 per extra change (max 50)
//         ... and +10 if any of those changes was medium or high risk
//   D3    amount above the currency's approval threshold ................ 30
//   D2    overdue, or due within 3 days of the as-of date ............... 20
//   D4    S/4 payment block present (already blocked; explain why) ...... 10
// Levels: High >= 60 · Medium 30–59 · Low < 30

const LEVELS = [[60, 'High'], [30, 'Medium'], [0, 'Low']]

function priority(s) {
  let score = 0
  const reasons = []
  const add = (points, text) => { score += points; reasons.push(`+${points} ${text}`) }
  if (s.onHold) add(60, 'supplier is on payment hold after a bank-detail change (P4)')
  if (s.duplicate) add(60, 'possible duplicate of another invoice (D1)')
  if (s.changes30d == null) reasons.push('+0 supplier change history unknown (supplier not in P4)')
  else if (s.changes30d > 0) {
    add(Math.min(50, 30 + 10 * (s.changes30d - 1)), `supplier data changed ${s.changes30d} time(s) in the last 30 days (P4)`)
    if (s.riskyChange) add(10, 'one of those changes was medium or high risk (name, tax number, country, bank or contact)')
  }
  if (s.aboveThreshold) add(30, 'amount above the approval threshold (D3)')
  if (s.dueSoon) add(20, 'overdue or due within 3 days (D2)')
  if (s.s4Blocked) add(10, 'S/4 payment block present (D4)')
  const level = LEVELS.find(([min]) => score >= min)[1]
  return { score, level, reasons }
}

module.exports = { priority }
