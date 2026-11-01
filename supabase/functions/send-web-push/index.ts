// Delivers notifications marked push_status = 'PENDING' to every browser the
// member turned alerts on in. Secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.org), PULSE_BASE_URL
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
const baseUrl = Deno.env.get('PULSE_BASE_URL') ?? ''

Deno.serve(async () => {
  const { data: pending, error } = await supabase
    .from('notifications').select('id, recipient_member_id, title, body, action_url')
    .eq('push_status', 'PENDING').order('created_at').limit(50)
  if (error) return new Response(error.message, { status: 500 })

  let sent = 0
  for (const n of pending ?? []) {
    const { data: subs } = await supabase
      .from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('member_id', n.recipient_member_id)
    let ok = false
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: `Pulse: ${n.title}`, body: n.body, url: `${baseUrl}${n.action_url ?? '/facilities'}` }))
        ok = true
      } catch (e) {
        // 404/410: the browser unsubscribed, so forget that endpoint.
        if (e?.statusCode === 404 || e?.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('id', s.id)
      }
    }
    await supabase.from('notifications').update({ push_status: ok ? 'SENT' : 'FAILED' }).eq('id', n.id)
    if (ok) sent++
  }
  return Response.json({ checked: pending?.length ?? 0, sent })
})
