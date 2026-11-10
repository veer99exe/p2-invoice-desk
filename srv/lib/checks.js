// Checks D1–D4 (S5). Pure functions: no calls to S/4 or P4, so they can be tested with hand-made rows.

const DAY = 864e5

const ms  = v => (v instanceof Date ? v.getTime() : Date.parse(String(v).slice(0, 10) + 'T00:00:00Z'))
const iso = t => new Date(t).toISOString().slice(0, 10)

/**
 * As-of date for the due check: today, unless the newest DocumentDate is more than 30 days old
 * (the sandbox data is old); then that newest date, shown on screen as "checked as of".
 */
function asOfDate(rows, today) {
  const dates = rows.map(r => r.DocumentDate).filter(Boolean).map(ms)
  if (!dates.length) return today
  const newest = Math.max(...dates)
  return ms(today) - newest > 30 * DAY ? iso(newest) : today
}

/**
 * @param rows        invoices (A_SupplierInvoice field names)
 * @param asOf        'YYYY-MM-DD'
 * @param thresholds  { EUR: 10000, ... } (a currency without entry gives D3 = null: "not checked")
 * @returns per invoice (same order): { D1: boolean, D2: boolean, D3: boolean|null, D4: string|null, dueDate }
 */
function runChecks(rows, asOf, thresholds = {}) {
  // D1: same InvoicingParty + amount + currency, DocumentDates at most 30 days apart -> mark BOTH
  const groups = new Map()
  rows.forEach((r, i) => {
    const key = [r.InvoicingParty, Number(r.InvoiceGrossAmount), r.DocumentCurrency].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(i)
  })
  const dup = new Set()
  for (const idx of groups.values()) {
    for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
      const da = rows[idx[a]].DocumentDate, db = rows[idx[b]].DocumentDate
      if (da && db && Math.abs(ms(da) - ms(db)) <= 30 * DAY) { dup.add(idx[a]); dup.add(idx[b]) }
    }
  }

  const asOfMs = ms(asOf)
  return rows.map((r, i) => {
    // D2: due date = base date + net payment days; flag if before the as-of date or within 3 days after it
    let D2 = false, dueDate = null
    if (r.DueCalculationBaseDate && r.NetPaymentDays != null) {
      const due = ms(r.DueCalculationBaseDate) + Number(r.NetPaymentDays) * DAY
      dueDate = iso(due)
      D2 = due <= asOfMs + 3 * DAY
    }
    // D3: amount above the currency's approval threshold
    const t = thresholds[r.DocumentCurrency]
    const D3 = t == null ? null : Number(r.InvoiceGrossAmount) > Number(t)
    // D4: S/4 payment block code, if any
    const block = (r.PaymentBlockingReason ?? '').toString().trim()
    return { D1: dup.has(i), D2, D3, D4: block || null, dueDate }
  })
}

module.exports = { runChecks, asOfDate }
