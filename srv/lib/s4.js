// Reads the 200 newest supplier invoices from the S/4HANA Cloud sandbox (read-only, OData V2).
// Plain HTTP with the APIKey header, so no EDMX import is needed. Key and URL come from
// .cdsrc-private.json (requires.API_SUPPLIERINVOICE_PROCESS_SRV.credentials, as in the handover)
// or from the env vars S4_API_KEY / S4_URL.
const cds = require('@sap/cds')
const { httpError } = require('./errors')

const SERVICE = 'API_SUPPLIERINVOICE_PROCESS_SRV'
const DEFAULT_URL = `https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap/${SERVICE}`
const FIELDS = ['SupplierInvoice', 'FiscalYear', 'CompanyCode', 'InvoicingParty', 'DocumentDate', 'PostingDate',
  'DueCalculationBaseDate', 'NetPaymentDays', 'InvoiceGrossAmount', 'DocumentCurrency',
  'PaymentBlockingReason', 'DocumentHeaderText']

// OData V2 dates arrive as "/Date(1699488000000)/"
const v2date = v => {
  const m = /\/Date\((-?\d+)/.exec(v ?? '')
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null)
}

async function fetchInvoices() {
  const cred = cds.env.requires?.[SERVICE]?.credentials ?? {}
  const key = process.env.S4_API_KEY || cred.headers?.APIKey
  const base = (process.env.S4_URL || cred.url || DEFAULT_URL).replace(/\/+$/, '')
  if (!key) throw httpError(503, 'S/4 sandbox key missing: put it in .cdsrc-private.json or S4_API_KEY')

  const url = `${base}/A_SupplierInvoice?$select=${FIELDS.join(',')}&$orderby=DocumentDate desc&$top=200&$format=json`
  console.log('[S/4] GET', url)                       // the key is never logged
  let res
  try {
    res = await fetch(new URL(url), { headers: { APIKey: key, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  } catch (e) { throw httpError(503, `S/4 sandbox not reachable: ${e.message}`) }
  if (!res.ok) throw httpError(503, `S/4 sandbox answered HTTP ${res.status}${res.status === 401 ? ' (check the API key)' : ''}`)

  const rows = (await res.json())?.d?.results ?? []
  return rows.map(r => ({
    SupplierInvoice: r.SupplierInvoice, FiscalYear: r.FiscalYear, CompanyCode: r.CompanyCode,
    InvoicingParty: r.InvoicingParty,
    DocumentDate: v2date(r.DocumentDate), PostingDate: v2date(r.PostingDate),
    DueCalculationBaseDate: v2date(r.DueCalculationBaseDate),
    NetPaymentDays: r.NetPaymentDays == null || r.NetPaymentDays === '' ? null : Number(r.NetPaymentDays),
    InvoiceGrossAmount: Number(r.InvoiceGrossAmount), DocumentCurrency: r.DocumentCurrency,
    PaymentBlockingReason: r.PaymentBlockingReason || '', DocumentHeaderText: r.DocumentHeaderText || ''
  }))
}

module.exports = { fetchInvoices }
