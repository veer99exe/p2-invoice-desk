const cds = require('@sap/cds')
const { startFakes } = require('./fakes')

let fakes
beforeAll(async () => { fakes = await startFakes() })       // must run before cds.test() starts the server
afterAll(() => fakes.stop())

const { GET, POST, axios } = cds.test(__dirname + '/..')
axios.defaults.validateStatus = () => true                  // we assert on the status codes

const rita = { auth: { username: 'rita', password: 'rita' } }
const carla = { auth: { username: 'carla', password: 'carla' } }
const inv = (no, src = 'STORY') => `/invoices/Invoices(SupplierInvoice='${no}',FiscalYear='${new Date().getFullYear()}',Source='${src}')`
const decide = (no, body, who = rita) => POST(`${inv(no)}/InvoiceService.decide`, body, who)
const draft = (no, who = rita) => POST(`${inv(no)}/InvoiceService.draftExplanation`, {}, who)
const confirm = (no, text, who = rita) => POST(`${inv(no)}/InvoiceService.confirmNote`, { text }, who)

describe('list: S/4 + story + checks + priority', () => {
  let rows
  beforeAll(async () => { const r = await GET('/invoices/Invoices?$top=200', rita); expect(r.status).toBe(200); rows = r.data.value })

  test('reads the 200 newest from S/4 with the API key', () => {
    expect(fakes.s4.urls[0]).toContain('$top=200')
    expect(fakes.s4.urls[0]).toContain('$orderby=DocumentDate desc')
    expect(fakes.s4.headers[0].apikey).toBe('sandbox-key')
    expect(rows.filter(r => r.Source === 'S4')).toHaveLength(2)
    expect(rows.filter(r => r.Source === 'STORY').length).toBeGreaterThanOrEqual(7)
  })
  test('sandbox dates are converted (V2 /Date()/) and the as-of date is the newest sandbox date', () => {
    const s = rows.find(r => r.SupplierInvoice === '5105600001')
    expect(s.DocumentDate).toBe('2023-03-01')
    expect(s.CheckedAsOf).toBe('2023-03-01')
  })
  test('story checks and priority', () => {
    const by = n => rows.find(r => r.SupplierInvoice === n)
    expect(by('DEMO-9002').priorityLevel).toBe('High')              // on hold
    expect(by('DEMO-9004').DuplicateSuspected).toBe(true)
    expect(by('DEMO-9005').DuplicateSuspected).toBe(true)
    expect(by('DEMO-9003').AboveThreshold).toBe(true)
    expect(by('DEMO-9006').Overdue).toBe(true)
    expect(by('DEMO-9007').BlockedInS4).toBe(true)
    expect(by('DEMO-9001').priorityLevel).toBe('Low')
  })
})

describe('P2-R1 release during a hold or an S/4 block -> 409', () => {
  test('supplier on hold', async () => {
    const r = await decide('DEMO-9002', { decision: 'Release', rootCause: 'Supplier Data' })
    expect(r.status).toBe(409)
    expect(r.data.error.message).toMatch(/on hold/)
    expect(fakes.p4.puts).toHaveLength(0)
  })
  test('blocked in S/4', async () => {
    expect((await decide('DEMO-9007', { decision: 'Release' })).status).toBe(409)
  })
  test('keeping it blocked is fine', async () => {
    expect((await decide('DEMO-9002', { decision: 'Keep Blocked', rootCause: 'Supplier Data' })).status).toBe(200)
  })
})

describe('P2-R2 escalate without a note -> 400', () => {
  test('refused, nothing saved', async () => {
    const before = fakes.p4.puts.length
    const r = await decide('DEMO-9004', { decision: 'Escalate', rootCause: 'Duplicate', note: '   ' })
    expect(r.status).toBe(400)
    expect(fakes.p4.puts).toHaveLength(before)
  })
  test('with a note it is saved', async () => {
    expect((await decide('DEMO-9004', { decision: 'Escalate', rootCause: 'Duplicate', note: 'Looks like DEMO-9005' })).status).toBe(200)
  })
})

describe('P2-R3 release above the threshold', () => {
  test('clerk -> 403', async () => {
    const r = await decide('DEMO-9003', { decision: 'Release', rootCause: 'Above Threshold' })
    expect(r.status).toBe(403)
  })
  test('manager -> 200, saved in P4 under the manager\'s name', async () => {
    const r = await decide('DEMO-9003', { decision: 'Release', rootCause: 'Above Threshold' }, carla)
    expect(r.status).toBe(200)
    expect(r.data.Decision).toBe('Release')
    expect(fakes.p4.puts.at(-1)).toMatchObject({ decision: 'Release', decidedBy: 'carla', aiAssisted: false })
  })
  test('a clerk may release an invoice below the threshold', async () => {
    expect((await decide('DEMO-9001', { decision: 'Release', rootCause: 'Other' })).status).toBe(200)
  })
})

describe('G1-G4 AI draft', () => {
  test('G1 draft is returned, not stored', async () => {
    const puts = fakes.p4.puts.length
    const r = await draft('DEMO-9005')
    expect(r.status).toBe(200)
    expect(r.data.value).toMatch(/^Draft:/)
    expect(fakes.p4.puts).toHaveLength(puts)
  })
  test('G2 "Use and save" stores the note with aiAssisted = true; needs a decision and a text', async () => {
    expect((await confirm('DEMO-9006', 'x')).status).toBe(409)             // no decision yet
    await decide('DEMO-9006', { decision: 'Keep Blocked', rootCause: 'Overdue' })
    expect((await confirm('DEMO-9006', '  ')).status).toBe(400)
    const r = await confirm('DEMO-9006', 'Please confirm the due date.')
    expect(r.status).toBe(200)
    expect(fakes.p4.puts.at(-1)).toMatchObject({ decision: 'Keep Blocked', note: 'Please confirm the due date.', aiAssisted: true })
  })
  test('G3 text inside an invoice is sent as data, with a rule not to obey it', async () => {
    await draft('DEMO-9001')
    const body = fakes.groq.bodies.at(-1)
    const [system, user] = body.messages
    expect(body.model).toBe('openai/gpt-oss-120b')
    expect(system.content).toMatch(/untrusted/)
    expect(system.content).not.toMatch(/Ignore all previous/)               // planted text never becomes instruction
    expect(user.content).toMatch(/Ignore all previous instructions/)         // ... it only travels as data in the JSON
    expect(user.content).toMatch(/not instructions/)
  })
  test('G4 AI down -> 503, and deciding still works', async () => {
    fakes.groq.fail = true
    expect((await draft('DEMO-9005')).status).toBe(503)
    expect((await decide('DEMO-9005', { decision: 'Keep Blocked', rootCause: 'Duplicate' })).status).toBe(200)
    fakes.groq.fail = false
  })
  test('no GROQ_API_KEY -> 503', async () => {
    const key = process.env.GROQ_API_KEY; delete process.env.GROQ_API_KEY
    expect((await draft('DEMO-9005')).status).toBe(503)
    process.env.GROQ_API_KEY = key
  })
})

describe('P4 not reachable: never pretend a save worked', () => {
  test('release and escalate give 503, the list still loads', async () => {
    fakes.p4.down = true
    expect((await decide('DEMO-9001', { decision: 'Release' })).status).toBe(503)
    expect((await decide('DEMO-9001', { decision: 'Escalate', note: 'n' })).status).toBe(503)
    fakes.p4.down = false
  })
})

describe('decisions list and roles', () => {
  test('Decisions shows what P4 holds', async () => {
    const r = await GET('/invoices/Decisions', rita)
    expect(r.status).toBe(200)
    expect(r.data.value.length).toBeGreaterThan(0)
  })
  test('no login -> 401', async () => { expect((await GET('/invoices/Invoices')).status).toBe(401) })
})
