
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const BASE_URL = Deno.env.get('PULSE_BASE_URL') ?? ''

// TEST: All eligible notifications go to YOUR chat.
// LIVE: Notifications go to their intended member's chat.
const DELIVERY_MODE = Deno.env.get('TELEGRAM_DELIVERY_MODE')

// Optional: your personal Telegram chat ID. In test mode alerts also go to
// every tester who registered through the bot (telegram_test_chats, see
// telegram-webhook and TELEGRAM_TEST_HANDLES).
const TEST_CHAT_ID = Deno.env.get('TELEGRAM_TEST_CHAT_ID')

// Only these events should generate Telegram messages.
const ALLOWED_TYPES = [
  'WAITLIST_OFFER',
  'WAITLIST_REMINDER',
  'TRANSFER_APPROVED',
  'TRANSFER_REJECTED',
  'TRANSFER_EXPIRED'
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
  return 'Open in Pulse'
}

function messageFor(n: Notification, linkAsText: boolean): string {
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

    default:
      message = `Pulse: ${n.title}\n${n.body}${link}`
  }

  if (DELIVERY_MODE === 'test') {
    return `[PULSE TEST NOTIFICATION]\n\n${message}`
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
  // Look up the actual recipient's linked Telegram chat.
  if (recipientMemberId === null) {
    return []
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
    ? []
    : [String(data.telegram_chat_id)]
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

  if (!['test', 'live'].includes(DELIVERY_MODE ?? '')) {
    return Response.json(
      { error: 'Set TELEGRAM_DELIVERY_MODE to test or live' },
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
      const chatIds = await getChatIds(n.recipient_member_id)

      if (!chatIds.length) {
        await updateStatus(n.id, 'NO_CHAT')
        results.push({
          id: n.id,
          status: 'NO_CHAT'
        })
        continue
      }

      const link = linkFor(n)
      const errors: string[] = []
      for (const chatId of chatIds) {
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
                    text: messageFor(n, false),
                    // A tappable button under the message.
                    reply_markup: {
                      inline_keyboard: [[{ text: buttonLabel(n.type), url: link }]]
                    }
                  }
                : { chat_id: chatId, text: messageFor(n, true) }
            )
          }
        )

        const result = await response.json()

        if (!response.ok || !result.ok) {
          errors.push(`${chatId}: ${result.description ?? `Telegram HTTP ${response.status}`}`)
        }
      }

      // Sent if at least one chat got it; a tester who blocked the bot shouldn't fail everyone.
      if (errors.length === chatIds.length) {
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
