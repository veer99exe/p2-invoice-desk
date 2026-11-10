// Client for P4's integration API (holds, thresholds, change history, decisions).
// Logs in with P4's technical client (OAuth client credentials) and reuses the token.
// Errors carry .status (400/403/404/409/503) and P4's own message.
const { httpError } = require('./errors')

let cached = { token: null, expires: 0 }
let pending = null          // one login at a time, even when several calls start together

const need = name => {
  const v = process.env[name]
  if (!v) throw httpError(503, `P4 not configured: ${name} is missing in .env`)
  return v
}

async function login() {
  if (cached.token && Date.now() < cached.expires - 30_000) return cached.token
  pending ??= fetchToken().finally(() => { pending = null })
  return pending
}

async function fetchToken() {
  const base = need('P4_TOKEN_URL').replace(/\/+$/, '').replace(/\/oauth\/token$/, '')
  const basic = Buffer.from(`${need('P4_CLIENT_ID')}:${need('P4_CLIENT_SECRET')}`).toString('base64')
  let res
  try {
    res = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15_000)
    })
  } catch (e) { throw httpError(503, `P4 login failed: ${e.message}`) }
  if (!res.ok) throw httpError(503, `P4 login failed (HTTP ${res.status}); check the P4 values in .env`)
  const { access_token, expires_in } = await res.json()
  cached = { token: access_token, expires: Date.now() + (expires_in ?? 600) * 1000 }
  return cached.token
}

/** p4('GET', '/HoldList') -> JSON body (a list is { value: [...] }); 204 -> null */
async function p4(method, path, body) {
  const token = await login()
  const url = need('P4_API_URL').replace(/\/+$/, '') + path
  let res
  try {
    res = await fetch(new URL(url), {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000)
    })
  } catch (e) { throw httpError(503, `P4 not reachable: ${e.message}`) }
  if (res.status === 401) cached = { token: null, expires: 0 }
  if (!res.ok) {
    let msg = `P4 answered HTTP ${res.status}`
    try { msg = (await res.json())?.error?.message || msg } catch { /* keep default */ }
    throw httpError([400, 403, 404, 409].includes(res.status) ? res.status : 503, msg)
  }
  return res.status === 204 ? null : res.json()
}

const resetP4Token = () => { cached = { token: null, expires: 0 }; pending = null }

module.exports = { p4, resetP4Token }
