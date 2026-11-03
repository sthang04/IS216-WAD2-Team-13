// @ts-nocheck
const EMAIL = Deno.env.get('ONEMAP_EMAIL')!
const PASSWORD = Deno.env.get('ONEMAP_PASSWORD')!
let cached: { token: string; expiry: number } | null = null

async function getToken() {
  if (cached && cached.expiry * 1000 > Date.now() + 60_000) return cached.token
  const res = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  })
  const data = await res.json()
  cached = { token: data.access_token, expiry: Number(data.expiry_timestamp) }
  return cached.token
}

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { from, to } = await req.json() // "lat,lng" strings
  const url = `https://www.onemap.gov.sg/api/public/routingsvc/route?start=${from}&end=${to}&routeType=walk`

  let res = await fetch(url, { headers: { Authorization: await getToken() } })
  if (res.status === 401) { // token expired early: refresh once and retry
    cached = null
    res = await fetch(url, { headers: { Authorization: await getToken() } })
  }
  if (!res.ok) {
    return new Response(JSON.stringify({ error: res.status }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const { route_summary } = await res.json()
  return new Response(JSON.stringify({
    minutes: Math.ceil(route_summary.total_time / 60),
    metres: Math.round(route_summary.total_distance)
  }), { headers: { ...cors, 'Content-Type': 'application/json' } })
})