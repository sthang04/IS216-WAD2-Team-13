// Telegram calls this when someone messages the bot. "/start <code>" links
// the chat to the member who generated the code in Pulse
// (rpc_create_telegram_link_code). Register with setWebhook and a
// secret_token equal to TELEGRAM_WEBHOOK_SECRET. Deploy with --no-verify-jwt.
//
// Testers: anyone whose @username is in TELEGRAM_TEST_HANDLES (comma separated,
// e.g. chloeanggggg,TinkerThian,gixellee,angellow365,Jerica_koh,ahlixia) who
// sends /start is saved in telegram_test_chats. In TELEGRAM_DELIVERY_MODE=test
// every Telegram alert goes to all of them. Bots can't message a @username
// first, so each tester has to /start the bot once.
//
// Safety: links are only made in private chats (never a group), a chat is
// linked to one Pulse account at a time (the newest link wins), each code
// works once and expires after 10 minutes, the reply names the Pulse
// account that was linked, and /stop unlinks this chat at any time.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
const testHandles = (Deno.env.get('TELEGRAM_TEST_HANDLES') ?? '')
  .split(',').map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean)

async function reply(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text })
  })
}

Deno.serve(async (req) => {
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== Deno.env.get('TELEGRAM_WEBHOOK_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }
  const update = await req.json()
  const message = update?.message
  const match = /^\/start\s+([a-f0-9]{18})$/.exec(message?.text ?? '')
  if (!message) return new Response('ok')
 
  // /stop: this chat stops getting Pulse notifications
  if (/^\/stop\b/.test(message.text ?? '')) {
    await supabase.from('telegram_links')
      .update({ telegram_chat_id: null, linked_at: null })
      .eq('telegram_chat_id', message.chat.id)
    await supabase.from('telegram_test_chats').delete().eq('chat_id', message.chat.id)
    await reply(message.chat.id, 'Disconnected. Pulse will no longer message this chat. Use Connect Telegram in Pulse to link again.')
    return new Response('ok')
  }
 
  // Never link a group chat: everyone in it would see someone's notifications
  if (message.chat?.type !== 'private') {
    if (match) await reply(message.chat.id, 'Pulse can only be connected in a private chat with the bot.')
    return new Response('ok')
  }

  // Tester registration: a plain /start from a listed @username.
  const username = (message.from?.username ?? '').toLowerCase()
  if (!match && /^\/start\b/.test(message.text ?? '') && testHandles.includes(username)) {
    await supabase.from('telegram_test_chats')
      .upsert({ username, chat_id: message.chat.id, registered_at: new Date().toISOString() })
    await reply(message.chat.id, `Hi @${message.from.username}, you'll now get Pulse test notifications here.`)
    return new Response('ok')
  }
  if (!match) return new Response('ok')

  const { data: link } = await supabase
    .from('telegram_links').select('member_id, code_expires_at').eq('link_code', match[1]).maybeSingle()
  if (!link || new Date(link.code_expires_at) < new Date()) {
    await reply(message.chat.id, 'That Pulse link code has expired. Generate a new one in Pulse.')
    return new Response('ok')
  }
  // One Telegram chat belongs to one Pulse account: linking it here unlinks
  // it from anyone it was linked to before, so it never gets two people's alerts
  await supabase.from('telegram_links')
    .update({ telegram_chat_id: null, linked_at: null })
    .eq('telegram_chat_id', message.chat.id)
    .neq('member_id', link.member_id)
  await supabase.from('telegram_links')
    .update({ telegram_chat_id: message.chat.id, linked_at: new Date().toISOString(), link_code: null })
    .eq('member_id', link.member_id)
  const { data: member } = await supabase.from('members').select('full_name').eq('id', link.member_id).maybeSingle()
  await reply(
    message.chat.id,
    `Connected to the Pulse account of ${member?.full_name ?? 'this member'}. ` +
    'Pulse will send waitlist offers and transfer updates here. Not you? Send /stop to disconnect.'
  )
  return new Response('ok')
})
