import { createClient } from 'jsr:@supabase/supabase-js@2'

// ============================================================
// PULSE TELEGRAM WEBHOOK
//
// Features:
// 1. Register approved Telegram testers using plain /start
// 2. Link PULSE accounts using /start <18-character-code>
// 3. Disconnect Telegram chats using /stop
// 4. Reject group-chat linking
// 5. Log registration failures for debugging
//
// The webhook is called automatically by Telegram.
// It must validate TELEGRAM_WEBHOOK_SECRET.
//
// Required Supabase secrets:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - TELEGRAM_BOT_TOKEN
// - TELEGRAM_WEBHOOK_SECRET
// - TELEGRAM_TEST_HANDLE
// ============================================================

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''

const testHandles = (
  Deno.env.get('TELEGRAM_TEST_HANDLE') ?? ''
)
  .split(',')
  .map((handle) =>
    handle.trim().replace(/^@/, '').toLowerCase()
  )
  .filter(Boolean)

type TelegramMessage = {
  message_id?: number
  text?: string
  chat: {
    id: number
    type: string
  }
  from?: {
    id: number
    username?: string
  }
}

type TelegramUpdate = {
  update_id?: number
  message?: TelegramMessage
}

// ============================================================
// SEND TELEGRAM REPLY
// ============================================================

async function reply(chatId: number, text: string) {
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is missing')
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    }
  )

  const result = await response.json()

  if (!response.ok || !result.ok) {
    console.error('Telegram sendMessage failed:', {
      status: response.status,
      description: result.description
    })

    throw new Error('Telegram could not send the reply')
  }
}

// ============================================================
// REGISTER TESTER
// ============================================================

async function registerTester(
  username: string,
  chatId: number
) {
  const { error } = await supabase
    .from('telegram_test_chats')
    .upsert(
      {
        username,
        chat_id: chatId,
        registered_at: new Date().toISOString()
      },
      {
        onConflict: 'username'
      }
    )

  if (error) {
    console.error('Tester registration failed:', {
      username,
      error: error.message
    })

    throw new Error('Unable to save Telegram tester')
  }

  console.log('Telegram tester registered:', username)
}

// ============================================================
// DISCONNECT CHAT
// ============================================================

async function disconnectChat(chatId: number) {
  const { error: linkError } = await supabase
    .from('telegram_links')
    .update({
      telegram_chat_id: null,
      linked_at: null,
      link_code: null,
      code_expires_at: null
    })
    .eq('telegram_chat_id', chatId)

  if (linkError) {
    throw new Error(
      `Unable to disconnect PULSE account: ${linkError.message}`
    )
  }

  const { error: testError } = await supabase
    .from('telegram_test_chats')
    .delete()
    .eq('chat_id', chatId)

  if (testError) {
    throw new Error(
      `Unable to disconnect tester: ${testError.message}`
    )
  }

  const { error: recipientError } = await supabase
    .from('demo_recipients')
    .update({ telegram_chat_id: null, updated_at: new Date().toISOString() })
    .eq('telegram_chat_id', chatId)

  if (recipientError) {
    throw new Error(
      `Unable to disconnect notification recipient: ${recipientError.message}`
    )
  }

  console.log('Telegram chat disconnected')
}

// ============================================================
// LINK PULSE ACCOUNT
// ============================================================

async function linkPulseAccount(
  chatId: number,
  code: string
) {
  const { data: link, error: lookupError } = await supabase
    .from('telegram_links')
    .select('member_id, code_expires_at')
    .eq('link_code', code)
    .maybeSingle()

  if (lookupError) {
    throw new Error(
      `Link lookup failed: ${lookupError.message}`
    )
  }

  if (
    !link ||
    !link.code_expires_at ||
    new Date(link.code_expires_at).getTime() <= Date.now()
  ) {
    await reply(
      chatId,
      'This PULSE link code is invalid or has expired. Please generate a new one in PULSE.'
    )
    return
  }

  // Consume the code only if it is still valid.
  // Clear any existing PULSE link associated with this chat.
  const { error: previousLinkError } = await supabase
    .from('telegram_links')
    .update({
      telegram_chat_id: null,
      linked_at: null
    })
    .eq('telegram_chat_id', chatId)
    .neq('member_id', link.member_id)

  if (previousLinkError) {
    throw new Error(
      `Previous chat unlink failed: ${previousLinkError.message}`
    )
  }

  const { data: updatedLinks, error: updateError } = await supabase
    .from('telegram_links')
    .update({
      telegram_chat_id: chatId,
      linked_at: new Date().toISOString(),
      link_code: null,
      code_expires_at: null
    })
    .eq('member_id', link.member_id)
    .eq('link_code', code)
    .gt('code_expires_at', new Date().toISOString())
    .select('member_id')

  if (updateError) {
    throw new Error(
      `Link update failed: ${updateError.message}`
    )
  }

  if (!updatedLinks || updatedLinks.length === 0) {
    await reply(
      chatId,
      'This link code has already been used or has expired.'
    )
    return
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('full_name')
    .eq('id', link.member_id)
    .maybeSingle()

  if (memberError) {
    console.error('Member lookup failed:', memberError.message)
  }

  console.log('PULSE member linked:', link.member_id)

  await reply(
    chatId,
    `Connected to the PULSE account of ${member?.full_name ?? 'this member'}. ` +
    'You will receive PULSE notifications for this account. ' +
    'Not you? Send /stop to disconnect.'
  )
}

// ============================================================
// MAIN WEBHOOK
// ============================================================

Deno.serve(async (req) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Check Telegram webhook secret
  if (
    !webhookSecret ||
    req.headers.get('X-Telegram-Bot-Api-Secret-Token') !==
      webhookSecret
  ) {
    console.warn('Rejected request: invalid webhook secret')
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const update = await req.json() as TelegramUpdate
    const message = update.message

    if (!message) {
      return new Response('ok')
    }

    const chatId = message.chat.id
    const chatType = message.chat.type

    const username = (
      message.from?.username ?? ''
    ).trim().toLowerCase()

    const messageText = (
      message.text ?? ''
    ).trim()

    const linkMatch =
      /^\/start\s+([a-f0-9]{18})$/.exec(messageText)

    const isAllowedTester = testHandles.includes(username)

    // Log registration diagnostics without logging
    // Telegram chat IDs, bot tokens or link codes.
    console.log('Telegram incoming update:', {
      username,
      chatType,
      command: messageText.split(/\s+/)[0],
      hasLinkCode: Boolean(linkMatch),
      isAllowedTester
    })

    // --------------------------------------------------------
    // /stop
    // --------------------------------------------------------

    if (/^\/stop(?:\s|$)/.test(messageText)) {
      if (chatType !== 'private') {
        return new Response('ok')
      }

      await disconnectChat(chatId)

      await reply(
        chatId,
        'Disconnected. You will no longer receive PULSE Telegram notifications here.'
      )

      return new Response('ok')
    }

    // --------------------------------------------------------
    // Reject group chats
    // --------------------------------------------------------

    if (chatType !== 'private') {
      if (/^\/start\b/.test(messageText)) {
        await reply(
          chatId,
          'Please open a private chat with the PULSE bot to connect.'
        )
      }

      return new Response('ok')
    }

    // --------------------------------------------------------
    // Plain /start = tester registration
    // --------------------------------------------------------

    if (/^\/start$/.test(messageText)) {
      if (!username) {
        await reply(
          chatId,
          'Please set a Telegram username in Settings, then send /start again.'
        )

        console.warn('Tester registration rejected: no username')
        return new Response('ok')
      }

      if (!isAllowedTester) {
        console.warn(
          'Tester registration rejected: username not allowed',
          username
        )

        await reply(
          chatId,
          'To receive your own PULSE alerts, sign in to PULSE, open Notifications and choose Connect Telegram. Then press Start using that account link. You do not need to join the tester list.'
        )

        return new Response('ok')
      }

      await registerTester(username, chatId)

      await reply(
        chatId,
        `Hi @${username}! You are now registered for PULSE test notifications.`
      )

      return new Response('ok')
    }

    // --------------------------------------------------------
    // /start CODE = PULSE account linking
    // --------------------------------------------------------

    if (linkMatch) {
      await linkPulseAccount(chatId, linkMatch[1])
      return new Response('ok')
    }

    // Invalid /start formats
    if (/^\/start\b/.test(messageText)) {
      await reply(
        chatId,
        'To register as a tester, send /start. To link a PULSE account, use Connect Telegram on the website.'
      )
    }

    return new Response('ok')

  } catch (error) {
    console.error(
      'Telegram webhook error:',
      error instanceof Error ? error.message : String(error)
    )

    // Telegram may retry failed deliveries; keep diagnostics in logs.
    return new Response('Internal server error', { status: 500 })
  }
})
