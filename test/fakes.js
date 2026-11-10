// Fake P4 (login + API), fake S/4 sandbox and fake Groq, so the service can be tested without any real system.
const http = require('http')

const listen = handler => new Promise(resolve => {
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => handler(req, res, body))
  })
  srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }))
})
const send = (res, status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(json === undefined ? '' : JSON.stringify(json)) }

const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)

async function startFakes() {
  const f = { p4: { puts: [], decisions: {}, down: false },
              s4: { urls: [], headers: [] },
              groq: { bodies: [], fail: false } }

  const p4s = await listen((req, res, body) => {
    if (req.url === '/oauth/token') return send(res, 200, { access_token: 'tok', expires_in: 3600 })
    if (f.p4.down) return send(res, 503, { error: { message: 'down' } })
    if (req.headers.authorization !== 'Bearer tok') return send(res, 401, {})
    const path = decodeURI(req.url)
    if (path.startsWith('/api/Thresholds')) return send(res, 200, { value: [{ currency: 'EUR', amount: 10000 }, { currency: 'USD', amount: 11000 }] })
    if (path.startsWith('/api/HoldList')) return send(res, 200, { value: [{ supplierNo: '1000104', holdUntil: future, reason: 'Bank details changed' }] })
    if (path.startsWith('/api/ChangeRequests')) return send(res, 200, { value: [] })
    if (path.startsWith('/api/Suppliers')) return send(res, 200, { value: ['1000101', '1000102', '1000103', '1000104', '1000105', '1000106'].map(supplierNo => ({ supplierNo })) })
    if (path === '/api/InvoiceDecisions') return send(res, 200, { value: Object.values(f.p4.decisions) })
    const m = /^\/api\/InvoiceDecisions\(source='(.*)',SupplierInvoice='(.*)',FiscalYear='(.*)'\)$/.exec(path)
    if (m && req.method === 'PUT') {
      const b = JSON.parse(body)
      if (b.decision === 'Escalate' && !b.note) return send(res, 400, { error: { message: 'An escalation needs a note.' } })
      f.p4.puts.push(b)
      f.p4.decisions[m[0]] = { source: m[1], SupplierInvoice: m[2], FiscalYear: m[3], ...b, decidedAt: new Date().toISOString() }
      return send(res, 200, f.p4.decisions[m[0]])
    }
    send(res, 404, { error: { message: 'not found' } })
  })

  const s4s = await listen((req, res) => {
    f.s4.urls.push(decodeURI(req.url)); f.s4.headers.push(req.headers)
    const d = ms => `/Date(${ms})/`
    const row = (n, party, amt) => ({ SupplierInvoice: n, FiscalYear: '2023', CompanyCode: '1010', InvoicingParty: party,
      DocumentDate: d(Date.UTC(2023, 2, 1)), PostingDate: d(Date.UTC(2023, 2, 1)), DueCalculationBaseDate: d(Date.UTC(2023, 2, 1)),
      NetPaymentDays: '30', InvoiceGrossAmount: amt, DocumentCurrency: 'EUR', PaymentBlockingReason: '', DocumentHeaderText: 'sandbox' })
    send(res, 200, { d: { results: [row('5105600001', '17300001', '1234.50'), row('5105600002', '17300002', '99.00')] } })
  })

  const groq = await listen((req, res, body) => {
    if (f.groq.fail) return send(res, 500, {})
    f.groq.bodies.push(JSON.parse(body))
    send(res, 200, { choices: [{ message: { content: 'Draft: please check this invoice.' } }] })
  })

  Object.assign(process.env, {
    P4_API_URL: p4s.url + '/api', P4_TOKEN_URL: p4s.url, P4_CLIENT_ID: 'id', P4_CLIENT_SECRET: 'secret',
    S4_URL: s4s.url, S4_API_KEY: 'sandbox-key', GROQ_API_KEY: 'groq-key', GROQ_BASE_URL: groq.url
  })
  f.stop = () => [p4s, s4s, groq].forEach(s => s.srv.close())
  return f
}

module.exports = { startFakes }
