const cds = require('@sap/cds')
const { p4 } = require('./lib/p4')
const { fetchInvoices } = require('./lib/s4')
const { draft } = require('./lib/ai')
const { runChecks, asOfDate } = require('./lib/checks')
const { priority } = require('./lib/priority')
const { storyInvoices } = require('./lib/story')

const TTL_MS = 30_000                                   // S/4 + P4 are read once per list load, cached briefly
const CRITICALITY = { High: 1, Medium: 2, Low: 3 }      // colour on the screen
const DRAFT_PROMPT = 'You help an accounts-payable clerk. In at most 5 sentences, explain the check results and suggest a polite note to the buyer. Use only the facts given.'
const q = s => String(s).replace(/'/g, "''")             // OData string literal

module.exports = class InvoiceService extends cds.ApplicationService {
  async init() {
    const { Invoices, Decisions } = cds.entities('p2')
    const state = { at: 0, promise: null }

    // ---- load: S/4 once, P4 once, compute checks + priority, fill the in-memory tables ----
    const load = async () => {
      const today = new Date().toISOString().slice(0, 10)
      const warn = (what, e) => console.warn(`[P2] ${what}: ${e.message}`)

      let s4rows = []
      try { s4rows = await fetchInvoices() } catch (e) { warn('S/4 unavailable, showing story invoices only', e) }

      const P = { ok: true, thresholds: {}, holds: [], changes: [], known: new Set(), decisions: new Map() }
      try {
        const since = new Date(Date.now() - 30 * 864e5).toISOString()
        const [thr, holds, chg, sup, dec] = await Promise.all([
          p4('GET', '/Thresholds'),
          p4('GET', '/HoldList'),
          p4('GET', `/ChangeRequests?$filter=status eq 'A' and decidedAt ge ${since}&$select=supplierNo,riskTier,decidedAt`),
          p4('GET', '/Suppliers?$select=supplierNo'),
          p4('GET', '/InvoiceDecisions')
        ])
        P.thresholds = Object.fromEntries(thr.value.map(t => [t.currency, Number(t.amount)]))
        P.holds = holds.value.filter(h => String(h.holdUntil).slice(0, 10) >= today)
        P.changes = chg.value
        P.known = new Set(sup.value.map(s => String(s.supplierNo)))
        for (const d of dec.value) P.decisions.set(`${d.source}|${d.SupplierInvoice}|${d.FiscalYear}`, d)
      } catch (e) { P.ok = false; warn('P4 unavailable, priority incomplete', e) }

      const rows = []
      const groups = [
        { list: s4rows.map(r => ({ ...r, Source: 'S4' })), asOf: asOfDate(s4rows, today) },
        { list: storyInvoices(today), asOf: today }
      ]
      for (const g of groups) {
        const checks = runChecks(g.list, g.asOf, P.thresholds)
        g.list.forEach((r, i) => rows.push(buildRow(r, checks[i], g.asOf, P)))
      }

      const decisionRows = [...P.decisions.values()].map(d => ({
        Source: d.source, SupplierInvoice: d.SupplierInvoice, FiscalYear: d.FiscalYear,
        Decision: d.decision, RootCause: d.rootCause, Note: d.note, AIAssisted: d.aiAssisted,
        DecidedBy: d.decidedBy, DecidedAt: d.decidedAt
      }))

      const db = cds.db
      await db.run(DELETE.from(Invoices))
      if (rows.length) await db.run(INSERT.into(Invoices).entries(rows))
      await db.run(DELETE.from(Decisions))
      if (decisionRows.length) await db.run(INSERT.into(Decisions).entries(decisionRows))
      state.at = Date.now()
    }

    const refresh = async () => {
      if (Date.now() - state.at < TTL_MS) return
      state.promise ??= load().finally(() => { state.promise = null })
      return state.promise
    }

    const buildRow = (r, c, asOf, P) => {
      let pr = { score: 0, level: 'Unknown', reasons: ['Priority incomplete: P4 not reachable'] }
      if (P.ok) {
        const mine = P.changes.filter(x => String(x.supplierNo) === String(r.InvoicingParty))
        pr = priority({
          onHold: P.holds.some(h => String(h.supplierNo) === String(r.InvoicingParty)),
          duplicate: c.D1, dueSoon: c.D2, aboveThreshold: c.D3 === true, s4Blocked: !!c.D4,
          changes30d: P.known.has(String(r.InvoicingParty)) ? mine.length : null,   // null = P4 does not know the supplier
          riskyChange: mine.some(x => x.riskTier === 'M' || x.riskTier === 'H')     // no tier (null) = unknown, not low
        })
      }
      const d = P.decisions.get(`${r.Source}|${r.SupplierInvoice}|${r.FiscalYear}`)
      return {
        ...r,
        DocumentHeaderText: (r.DocumentHeaderText ?? '').slice(0, 255),
        DueDate: c.dueDate, CheckedAsOf: asOf,
        DuplicateSuspected: c.D1, Overdue: c.D2, AboveThreshold: c.D3, BlockedInS4: !!c.D4,
        priorityLevel: pr.level, priorityScore: pr.score,
        priorityReasons: pr.reasons.join('\n').slice(0, 1000), priorityCriticality: CRITICALITY[pr.level] ?? 0,
        Decision: d?.decision, RootCause: d?.rootCause, Note: d?.note, AIAssisted: d?.aiAssisted,
        DecidedBy: d?.decidedBy, DecidedAt: d?.decidedAt
      }
    }

    // ---- helpers for the bound actions ----
    const invoiceOf = async req => {
      await refresh()
      const k = req.params[0]
      const keys = { SupplierInvoice: k.SupplierInvoice, FiscalYear: k.FiscalYear, Source: k.Source }
      const inv = await cds.db.run(SELECT.one.from(Invoices).where(keys))
      if (!inv) req.reject(404, 'Invoice not found.')
      return { inv, keys }
    }
    const decisionKey = inv => `/InvoiceDecisions(source='${q(inv.Source)}',SupplierInvoice='${q(inv.SupplierInvoice)}',FiscalYear='${q(inv.FiscalYear)}')`
    const saveRow = async (keys, fields) => {
      state.at = 0                                          // next list load reads P4 again
      await cds.db.run(UPDATE(Invoices).set(fields).where(keys))
      return cds.db.run(SELECT.one.from(Invoices).where(keys))
    }

    this.before('READ', ['Invoices', 'Decisions'], () => refresh())

    // ---- decide: R1 (409), R2 (400), R3 (403); a decision is only "saved" when P4 says so ----
    this.on('decide', 'Invoices', async req => {
      const { decision, rootCause } = req.data
      const note = (req.data.note ?? '').trim()
      if (!decision) return req.reject(400, 'A decision is required.')
      if (decision === 'Escalate' && !note) return req.reject(400, 'An escalation needs a note.')            // R2 (P4 refuses it too)

      const { inv, keys } = await invoiceOf(req)

      if (decision === 'Release') {
        let holds, thresholds
        try {                                                // fresh from P4: a rule must not run on cached data
          [holds, thresholds] = (await Promise.all([p4('GET', '/HoldList'), p4('GET', '/Thresholds')])).map(x => x.value)
        } catch (e) { return req.reject(e.status ?? 503, e.message) }
        const today = new Date().toISOString().slice(0, 10)
        const hold = holds.find(h => String(h.supplierNo) === String(inv.InvoicingParty) && String(h.holdUntil).slice(0, 10) >= today)
        if (hold) return req.reject(409, `Release refused: supplier ${inv.InvoicingParty} is on hold until ${String(hold.holdUntil).slice(0, 10)}${hold.reason ? ` (${hold.reason})` : ''}.`)   // R1
        if (inv.BlockedInS4) return req.reject(409, `Release refused: the invoice is blocked in S/4 (payment block ${inv.PaymentBlockingReason}).`)                                                  // R1 (D4)
        const t = thresholds.find(x => x.currency === inv.DocumentCurrency)
        if (t && Number(inv.InvoiceGrossAmount) > Number(t.amount) && !req.user.is('APManager'))
          return req.reject(403, `Release refused: only an AP manager may release invoices above ${t.amount} ${t.currency}.`)                                                                      // R3
      }

      try {
        await p4('PUT', decisionKey(inv), { decision, rootCause, note: note || undefined, aiAssisted: false, decidedBy: req.user.id })
      } catch (e) { return req.reject(e.status ?? 503, e.message) }        // 400 from P4 is passed on; 503 = nothing saved
      return saveRow(keys, { Decision: decision, RootCause: rootCause ?? null, Note: note || null, AIAssisted: false, DecidedBy: req.user.id, DecidedAt: new Date().toISOString() })
    })

    // ---- AI draft (G1): facts only, returned, never stored; AI down = 503 and deciding still works ----
    this.on('draftExplanation', 'Invoices', async req => {
      const { inv } = await invoiceOf(req)
      try {
        return await draft(DRAFT_PROMPT, {
          invoice: inv.SupplierInvoice, supplier: inv.InvoicingParty,
          amount: Number(inv.InvoiceGrossAmount), currency: inv.DocumentCurrency,
          checks: {
            duplicateSuspected: !!inv.DuplicateSuspected, overdueOrDueSoon: !!inv.Overdue,
            aboveThreshold: inv.AboveThreshold ?? 'not checked', s4PaymentBlock: inv.PaymentBlockingReason || null
          },
          headerText: (inv.DocumentHeaderText ?? '').slice(0, 200)      // untrusted text: sent as data (G3)
        })
      } catch (e) { return req.reject(e.status ?? 503, e.message) }
    })

    // ---- "Use and save" (G2): the confirmed text becomes the note, aiAssisted = true ----
    this.on('confirmNote', 'Invoices', async req => {
      const text = (req.data.text ?? '').trim()
      if (!text) return req.reject(400, 'The note is empty.')
      const { inv, keys } = await invoiceOf(req)
      if (!inv.Decision) return req.reject(409, 'Record a decision first; the AI-assisted note is saved with it.')
      try {
        await p4('PUT', decisionKey(inv), { decision: inv.Decision, rootCause: inv.RootCause ?? undefined, note: text, aiAssisted: true, decidedBy: req.user.id })
      } catch (e) { return req.reject(e.status ?? 503, e.message) }
      return saveRow(keys, { Note: text, AIAssisted: true, DecidedBy: req.user.id, DecidedAt: new Date().toISOString() })
    })

    return super.init()
  }
}
