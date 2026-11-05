
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { demoTelegramTargets } from '../_shared/demoDelivery.js'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
let BASE_URL = Deno.env.get('PULSE_BASE_URL') ?? ''

// TEST: All eligible notifications go to YOUR chat.
// LIVE: Notifications go to their intended member's chat.
// DEMO: Notifications go to the teammate set for that persona in demo_recipients,
//       or else to the chat that persona linked with Connect Telegram.
const DELIVERY_MODE = Deno.env.get('TELEGRAM_DELIVERY_MODE')

// Optional: your personal Telegram chat ID. In test mode alerts also go to
// every tester who registered through the bot (telegram_test_chats, see
// telegram-webhook and TELEGRAM_TEST_HANDLES).
const TEST_CHAT_ID = Deno.env.get('TELEGRAM_TEST_CHAT_ID')

// Only these events should generate Telegram messages.
const ALLOWED_TYPES = [
  'OPS_CREW_REMINDER',
  'WAITLIST_OFFER',
  'WAITLIST_REMINDER',
  'TRANSFER_APPROVED',
  'TRANSFER_REJECTED',
  'TRANSFER_EXPIRED',
  'MEETING_REQUEST',
  'MEETING_NUDGE',
  'MEETING_CONFIRMED',
  'MEETING_CANCELLED',
  'MEETING_REMOVED',
  'MEETING_AGENDA_UPDATED',
  'SCHEDULE_CHANGED',
  'OPS_SCHEDULE_CHANGED'
]

type Notification = {
  id: number
  recipient_member_id: number | null
  recipient_club_id: number | null
  type: string
  title: string
  body: string
  action_url: string | null
}

// Telegram only makes a link tappable when it points at a real public address.
// http://localhost:5173 is never linked, and buttons pointing at it are rejected,
// so while testing on localhost the address is shown as plain text instead.
function isPublicUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return ['http:', 'https:'].includes(protocol) &&
      !['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) &&
      !hostname.endsWith('.local')
  } catch {
    return false
  }
}

// The page the message is about. as/club make the demo open as the recipient.
function linkFor(n: Notification): string {
  const url = new URL(n.action_url ?? '/facilities', BASE_URL || 'http://localhost:5173')
  if (n.recipient_member_id) url.searchParams.set('as', String(n.recipient_member_id))
  if (n.recipient_club_id) url.searchParams.set('club', String(n.recipient_club_id))
  return url.toString()
}

function buttonLabel(type: string): string {
  if (type === 'WAITLIST_OFFER' || type === 'WAITLIST_REMINDER') return 'Claim the slot in Pulse'
  if (type === 'MEETING_REQUEST' || type === 'MEETING_NUDGE') return 'Mark my availability'
  if (type === 'MEETING_CONFIRMED') return 'View meeting'
  if (type.startsWith('TRANSFER_')) return 'View booking'
  if (type === 'SCHEDULE_CHANGED') return 'My Schedule'
  if (type === 'OPS_SCHEDULE_CHANGED') return 'View run of show'
  if (type.startsWith('MEETING_')) return 'View meeting'
  return 'Open Pulse'
}

function messageFor(n: Notification, linkAsText: boolean, personaLabel: string | null = null): string {
  const link = linkAsText ? `\n\n${linkFor(n)}` : ''

  let message: string

  switch (n.type) {
    case 'WAITLIST_OFFER':
      message =
        `🎉 Pulse Waitlist Offer\n\n` +
        `${n.body}\n\n` +
        `You have 30 minutes to claim this slot.${link}`
      break

    case 'WAITLIST_REMINDER':
      message =
        `⏰ Pulse Waitlist Reminder\n\n` +
        `${n.body}${link}`
      break

    case 'TRANSFER_APPROVED':
      message =
        `✅ Transfer Approved by OSL\n\n` +
        `${n.body}${link}`
      break

    case 'TRANSFER_REJECTED':
      message =
        `❌ Transfer Rejected by OSL\n\n` +
        `${n.body}${link}`
      break

    case 'TRANSFER_EXPIRED':
      message =
        `⌛ OSL Sign-off Deadline Passed\n\n` +
        `${n.body}${link}`
      break

    case 'MEETING_REQUEST':
      message =
        `🗓 Pulse Meeting Request\n\n` +
        `${n.body}${link}`
      break

    case 'MEETING_NUDGE':
      message =
        `⏰ Pulse Meeting Reminder\n\n` +
        `${n.body}${link}`
      break

    case 'MEETING_CONFIRMED':
      message =
        `✅ Meeting Confirmed\n\n` +
        `${n.body}${link}`
      break

    case 'MEETING_CANCELLED':
      message =
        `❌ Meeting Cancelled\n\n` +
        `${n.body}${link}`
      break

    default:
      message = `Pulse: ${n.title}\n${n.body}${link}`
  }

  if (DELIVERY_MODE === 'test') {
    return `[PULSE TEST NOTIFICATION]\n\n${message}`
  }

  // One Telegram account can stand in for several personas
  if (DELIVERY_MODE === 'demo' && personaLabel) {
    return `For: ${personaLabel}\n\n${message}`
  }

  return message
}

async function getChatIds(
  recipientMemberId: number | null
): Promise<string[]> {

  // TEST MODE: the same alerts go to TEST_CHAT_ID and every registered tester,
  // whichever Pulse persona they are about.
  if (DELIVERY_MODE === 'test') {
    const { data, error } = await supabase.from('telegram_test_chats').select('chat_id')
    if (error) {
      throw new Error(`Test chat lookup failed: ${error.message}`)
    }
    const ids = (data ?? []).map((r) => String(r.chat_id))
    if (TEST_CHAT_ID) ids.push(TEST_CHAT_ID)
    return [...new Set(ids)]
  }

  // LIVE MODE:
  const chatId = await liveChatId(recipientMemberId)
  return chatId === null ? [] : [chatId]
}

// Look up the actual recipient's linked Telegram chat.
async function liveChatId(
  recipientMemberId: number | null
): Promise<string | null> {
  if (recipientMemberId === null) {
    return null
  }

  const { data, error } = await supabase
    .from('telegram_links')
    .select('telegram_chat_id')
    .eq('member_id', recipientMemberId)
    .maybeSingle()

  if (error) {
    throw new Error(`Chat lookup failed: ${error.message}`)
  }

  return data?.telegram_chat_id == null
    ? null
    : String(data.telegram_chat_id)
}

async function updateStatus(
  notificationId: number,
  status: string
) {
  const { error } = await supabase
    .from('notifications')
    .update({ telegram_status: status })
    .eq('id', notificationId)

  if (error) {
    throw new Error(
      `Unable to update notification ${notificationId}: ${error.message}`
    )
  }
}

Deno.serve(async () => {
  // Fail closed if configuration is missing.
  if (!BOT_TOKEN) {
    return Response.json(
      { error: 'TELEGRAM_BOT_TOKEN is missing' },
      { status: 500 }
    )
  }

  if (!['test', 'live', 'demo'].includes(DELIVERY_MODE ?? '')) {
    return Response.json(
      { error: 'Set TELEGRAM_DELIVERY_MODE to test, live or demo' },
      { status: 500 }
    )
  }

  if (
    DELIVERY_MODE === 'test' &&
    TEST_CHAT_ID &&
    !/^-?\d+$/.test(TEST_CHAT_ID)
  ) {
    return Response.json(
      { error: 'TELEGRAM_TEST_CHAT_ID must be a numeric chat id' },
      { status: 500 }
    )
  }

  // Use the existing public app setting if the optional Edge secret is absent.
  if (!BASE_URL) {
    const configured = await supabase.rpc('cfg_text', { p_key: 'pulse_base_url' })
    if (configured.error || !configured.data || !isPublicUrl(configured.data)) return Response.json({ error: 'Public Pulse URL unavailable' }, { status: 503 })
    BASE_URL = configured.data
  }

  const { error: reminderError } = await supabase.rpc('queue_ops_crew_reminders')
  if (reminderError) {
    return Response.json({ error: reminderError.message }, { status: 500 })
  }

  const { data: pending, error } = await supabase
    .from('notifications')
    .select(
      'id, recipient_member_id, recipient_club_id, type, title, body, action_url'
    )
    .eq('telegram_status', 'PENDING')
    .order('created_at')
    .limit(50)

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }

  // Stop before marking anything if the mapping can't be read
  let demoRoutes: any[] = []
  if (DELIVERY_MODE === 'demo') {
    const routes = await supabase.from('demo_recipient_routes').select('*')
    if (routes.error) {
      return Response.json({ error: routes.error.message }, { status: 500 })
    }
    demoRoutes = routes.data ?? []
  }
  const seenEvents = new Set<string>()

  let sent = 0
  let failed = 0
  let skipped = 0

  const results = []

  for (const n of (pending ?? []) as Notification[]) {

    // Do not deliver ordinary in-app notifications.
    if (!ALLOWED_TYPES.includes(n.type)) {
      await updateStatus(n.id, 'NOT_REQUIRED')
      skipped++
      continue
    }

    try {
      let targets: { chatId: string, label: string | null }[]
      if (DELIVERY_MODE === 'demo') {
        // Uses the LIVE lookup above for the chat linked with Connect Telegram
        const linked = await liveChatId(n.recipient_member_id)
        targets = demoTelegramTargets(n, demoRoutes, linked, seenEvents, { allowCopies: !['SCHEDULE_CHANGED', 'OPS_SCHEDULE_CHANGED', 'OPS_CREW_REMINDER'].includes(n.type) })
      } else {
        targets = (await getChatIds(n.recipient_member_id)).map((chatId) => ({ chatId, label: null }))
      }

      if (!targets.length) {
        await updateStatus(n.id, 'NO_CHAT')
        results.push({
          id: n.id,
          status: 'NO_CHAT'
        })
        continue
      }

      const link = linkFor(n)
      const errors: string[] = []
      for (const { chatId, label } of targets) {
        const response = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(
              isPublicUrl(link)
                ? {
                    chat_id: chatId,
                    text: messageFor(n, false, label),
                    // A tappable button under the message.
                    reply_markup: {
                      inline_keyboard: [[{ text: buttonLabel(n.type), url: link }]]
                    }
                  }
                : { chat_id: chatId, text: messageFor(n, true, label) }
            )
          }
        )

        const result = await response.json()

        if (!response.ok || !result.ok) {
          errors.push(`${chatId}: ${result.description ?? `Telegram HTTP ${response.status}`}`)
        }
      }

      // Sent if at least one chat got it; a tester who blocked the bot shouldn't fail everyone.
      if (errors.length === targets.length) {
        throw new Error(errors.join('; '))
      }
      if (errors.length) console.warn(`Telegram notification ${n.id} partly failed:`, errors.join('; '))

      await updateStatus(n.id, 'SENT')
      sent++

      results.push({
        id: n.id,
        status: 'SENT'
      })

    } catch (err) {
      failed++

      console.error(
        `Telegram notification ${n.id} failed:`,
        err instanceof Error ? err.message : String(err)
      )

      await updateStatus(n.id, 'FAILED')

      results.push({
        id: n.id,
        status: 'FAILED'
      })
    }
  }

  return Response.json({
    delivery_mode: DELIVERY_MODE,
    checked: pending?.length ?? 0,
    sent,
    failed,
    skipped,
    results
  })
})
