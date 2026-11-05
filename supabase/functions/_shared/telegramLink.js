// What the bot says around linking. The link code decides who gets linked, never the
// handle: usernames can be changed, so a matching one proves nothing. A mismatch only warns.

export const START_HELP =
  'To get Pulse alerts, sign in to Pulse and press Connect Telegram in the notification bell. It brings you back here to finish linking.'

function normalise(handle) {
  return String(handle ?? '').trim().replace(/^@/, '').toLowerCase()
}

export function handleMismatchNote(savedHandle, telegramUsername) {
  const saved = normalise(savedHandle)
  const actual = normalise(telegramUsername)
  if (!saved || saved === actual) return ''
  const account = actual ? `this Telegram account is @${actual}` : 'this Telegram account has no username'
  return ` Heads up: you signed up with @${saved}, but ${account}. If this is the wrong account, send /stop and connect again.`
}
