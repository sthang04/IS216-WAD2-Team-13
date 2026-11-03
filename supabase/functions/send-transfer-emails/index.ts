// Sends queued rows from transfer_emails through Resend (https://resend.com).
// Secrets (supabase secrets set ...): RESEND_API_KEY, EMAIL_FROM,
// EMAIL_LIVE_MODE ("true" to send to real recipients), TEST_EMAIL_RECIPIENT.
// Until EMAIL_LIVE_MODE=true, every email goes to TEST_EMAIL_RECIPIENT only.
// TEST_EMAIL_RECIPIENT can list several inboxes, comma separated, e.g.
//   chloe.a.2025@computing.smu.edu.sg,sa.thang.2023@scis.smu.edu.sg
// (Resend's onboarding@resend.dev sender only delivers to the Resend account's
// own address; verify a domain in Resend to send to more than one inbox.)
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const live = Deno.env.get('EMAIL_LIVE_MODE') === 'true'
const testInboxes = (Deno.env.get('TEST_EMAIL_RECIPIENT') ?? '').split(',').map((e) => e.trim()).filter(Boolean)

Deno.serve(async () => {
  const { data: queued, error } = await supabase
    .from('transfer_emails').select('*').eq('status', 'QUEUED').order('queued_at').limit(20)
  if (error) return new Response(error.message, { status: 500 })

  const results = []
  for (const email of queued ?? []) {
    // Claim the row first so two overlapping runs never send it twice.
    const { data: claimed } = await supabase
      .from('transfer_emails')
      .update({ status: 'SENDING', attempts: (email.attempts ?? 0) + 1 })
      .eq('id', email.id).eq('status', 'QUEUED').select('id')
    if (!claimed?.length) continue

    const to = live ? (email.to_emails ?? []) : testInboxes
    const cc = live ? (email.cc_emails ?? []) : []
    const body = live ? email.body
      : `[TEST MODE: would have gone to ${(email.to_emails ?? []).join(', ')}; cc ${(email.cc_emails ?? []).join(', ') || 'none'}]\n\n${email.body}`

    try {
      if (!to.length || !to[0]) throw new Error('No recipient configured')
      // Attach the original FBS booking slip to the OSL request when one is stored.
      const { data: booking } = await supabase.from('facility_bookings').select('booking_slip_url, fbs_reference').eq('id', email.booking_id).maybeSingle()
      const attachments = booking?.booking_slip_url
        ? [{ path: booking.booking_slip_url, filename: `FBS-${booking.fbs_reference}${booking.booking_slip_url.match(/\.[a-z0-9]+$/i)?.[0] ?? '.pdf'}` }]
        : undefined
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: Deno.env.get('EMAIL_FROM'), to, cc, reply_to: email.reply_to ?? undefined, subject: email.subject, text: body, attachments })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.message ?? `HTTP ${res.status}`)
      await supabase.from('transfer_emails')
        .update({ status: 'SENT', sent_at: new Date().toISOString(), provider_message_id: json.id, last_error: null })
        .eq('id', email.id)
      // Mirror the send on the transfer row (facility_transfers.email_status).
      await supabase.from('facility_transfers')
        .update({ email_status: email.email_type === 'TRANSFER_CONFIRMED' ? 'CONFIRMATION_SENT' : 'SENT' })
        .eq('id', email.transfer_id)
      results.push({ id: email.id, status: 'SENT' })
    } catch (e) {
      await supabase.from('transfer_emails').update({ status: 'FAILED', last_error: String(e) }).eq('id', email.id)
      results.push({ id: email.id, status: 'FAILED', error: String(e) })
    }
  }
  return Response.json({ processed: results.length, results })
})
