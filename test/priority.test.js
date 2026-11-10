const { priority } = require('../srv/lib/priority')
const base = { onHold: false, duplicate: false, changes30d: 0, riskyChange: false, aboveThreshold: false, dueSoon: false, s4Blocked: false }
const p = o => priority({ ...base, ...o })

test('PR1 supplier on hold is High on its own', () => expect(p({ onHold: true })).toMatchObject({ score: 60, level: 'High' }))
test('PR2 possible duplicate is High on its own', () => expect(p({ duplicate: true })).toMatchObject({ score: 60, level: 'High' }))
test('PR3 above threshold alone is Medium', () => expect(p({ aboveThreshold: true })).toMatchObject({ score: 30, level: 'Medium' }))
test('PR4 due soon alone is Low', () => expect(p({ dueSoon: true })).toMatchObject({ score: 20, level: 'Low' }))
test('PR5 supplier changes: 30 for the first, +10 each further, +10 if risky', () => {
  expect(p({ changes30d: 1 }).score).toBe(30)
  expect(p({ changes30d: 2, riskyChange: true }).score).toBe(50)
})
test('PR6 change points are capped at 50', () => expect(p({ changes30d: 9 }).score).toBe(50))
test('PR7 unknown supplier history adds nothing and says so', () => {
  const r = p({ changes30d: null })
  expect(r.score).toBe(0)
  expect(r.reasons[0]).toMatch(/unknown/)
})
test('PR8 signals add up and every point is explained', () => {
  const r = p({ aboveThreshold: true, dueSoon: true, s4Blocked: true })
  expect(r).toMatchObject({ score: 60, level: 'High' })
  expect(r.reasons).toHaveLength(3)
})
