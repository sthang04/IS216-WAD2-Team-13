// Resolve recipients for real email and Telegram delivery. Email uses configured
// persona routes. Telegram prioritises an explicitly linked account, with a
// configured stand-in as fallback. Unmapped users receive no observer copies.

const OSL_EMAIL_TYPES = ['OSL_REQUEST', 'OSL_DEADLINE_REMINDER']

function clean(address) {
  return String(address ?? '').trim().toLowerCase()
}

// claimingClubId / releasingClubId come from the email's transfer.
// blocked = every real staff and CCA address, which a stand-in must never be.
export function resolveEmailRecipients(email, routes, { claimingClubId = null, releasingClubId = null, blocked = [] } = {}) {
  const realAddresses = new Set([...blocked, ...(email.to_emails ?? []), ...(email.cc_emails ?? [])].map(clean))
  const inTransfer = (route) => (route.club_ids ?? []).some((id) => id === claimingClubId || id === releasingClubId)
  const intended = (route) => {
    if (route.copy_all) return true
    if (OSL_EMAIL_TYPES.includes(email.email_type)) return route.is_osl_admin
    if (email.email_type === 'TRANSFER_CONFIRMED') return inTransfer(route)
    return false
  }

  const to = []
  const personas = []
  for (const route of routes) {
    const address = clean(route.email)
    if (!address || realAddresses.has(address) || !intended(route)) continue
    personas.push(route.persona_label)
    if (!to.includes(address)) to.push(address)
  }
  return { to, personas }
}

// seenEvents remembers alerts already copied this run: one event is one row per
// club member, and a copy_all persona should get it once. Returns [{ chatId, label }].
export function resolveTelegramRecipients(notification, routes, linkedChatId, seenEvents, { allowCopies = true } = {}) {
  const targets = []
  const add = (chatId, label) => {
    const id = String(chatId)
    if (!targets.some((t) => t.chatId === id)) targets.push({ chatId: id, label })
  }

  const own = routes.find((r) => r.member_id !== null && r.member_id === notification.recipient_member_id)
  // An explicit account link wins over a stand-in mapping. New users need no hardcoded route.
  if (linkedChatId != null) add(linkedChatId, own?.persona_label ?? null)
  else if (own?.telegram_chat_id != null) add(own.telegram_chat_id, own.persona_label)

  const event = [notification.type, notification.title, notification.body].join('|')
  // Copies apply only to mapped personas, never unrelated real users or private alerts.
  if (allowCopies && own && !seenEvents.has(event)) {
    seenEvents.add(event)
    for (const route of routes) {
      if (route.copy_all && route.telegram_chat_id != null) add(route.telegram_chat_id, `${route.persona_label} (copy)`)
    }
  }
  return targets
}
