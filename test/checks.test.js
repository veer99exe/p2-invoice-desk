const { runChecks, asOfDate } = require('../srv/lib/checks')

const inv = (o = {}) => ({
  SupplierInvoice: '1', InvoicingParty: '100', InvoiceGrossAmount: 500, DocumentCurrency: 'EUR',
  DocumentDate: '2026-11-01', DueCalculationBaseDate: '2026-11-01', NetPaymentDays: 30, PaymentBlockingReason: '', ...o
})
const T = { EUR: 10000 }

describe('P2-D1 duplicate', () => {
  test('same party, amount, currency within 30 days: both marked', () => {
    const r = runChecks([inv({ SupplierInvoice: 'a' }), inv({ SupplierInvoice: 'b', DocumentDate: '2026-11-20' }), inv({ SupplierInvoice: 'c', InvoicingParty: '200' })], '2026-11-10', T)
    expect(r.map(x => x.D1)).toEqual([true, true, false])
  })
  test('more than 30 days apart, other amount or other currency: not a duplicate', () => {
    const r = runChecks([inv(), inv({ DocumentDate: '2026-12-15' }), inv({ InvoiceGrossAmount: 501 }), inv({ DocumentCurrency: 'USD' })], '2026-11-10', T)
    expect(r.map(x => x.D1)).toEqual([false, false, false, false])
  })
})

describe('P2-D2 due', () => {
  test('overdue, due within 3 days, and not yet due', () => {
    const r = runChecks([
      inv({ DueCalculationBaseDate: '2026-09-01', NetPaymentDays: 30 }),   // due 10-01: overdue
      inv({ DueCalculationBaseDate: '2026-10-14', NetPaymentDays: 30 }),   // due 11-13: exactly 3 days after as-of
      inv({ DueCalculationBaseDate: '2026-10-15', NetPaymentDays: 30 })    // due 11-14: 4 days after
    ], '2026-11-10', T)
    expect(r.map(x => x.D2)).toEqual([true, true, false])
    expect(r[1].dueDate).toBe('2026-11-13')
  })
  test('as-of date is today, unless the newest invoice is older than 30 days', () => {
    expect(asOfDate([inv({ DocumentDate: '2026-11-05' })], '2026-11-10')).toBe('2026-11-10')
    expect(asOfDate([inv({ DocumentDate: '2023-03-01' }), inv({ DocumentDate: '2023-02-01' })], '2026-11-10')).toBe('2023-03-01')
  })
})

describe('P2-D3 threshold', () => {
  test('above, not above, and no threshold for the currency (null = not checked)', () => {
    const r = runChecks([inv({ InvoiceGrossAmount: 10000.01 }), inv({ InvoiceGrossAmount: 10000 }), inv({ DocumentCurrency: 'GBP', InvoiceGrossAmount: 99999 })], '2026-11-10', T)
    expect(r.map(x => x.D3)).toEqual([true, false, null])
  })
  test('amounts are compared as numbers, not as text', () => {
    expect(runChecks([inv({ InvoiceGrossAmount: '9000' })], '2026-11-10', T)[0].D3).toBe(false)
  })
})

describe('P2-D4 S/4 block', () => {
  test('returns the block code, or null when empty', () => {
    const r = runChecks([inv({ PaymentBlockingReason: 'R' }), inv({ PaymentBlockingReason: '' }), inv({ PaymentBlockingReason: null })], '2026-11-10', T)
    expect(r.map(x => x.D4)).toEqual(['R', null, null])
  })
})
