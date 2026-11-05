// Who receives each routed notification. Uses the example assignments with made-up addresses; nothing is sent.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveEmailRecipients, resolveTelegramRecipients } from '../../supabase/functions/_shared/notificationRecipientRouting.js'

const EURHYTHMIX = 1, SAMBA = 2, SYMPHONIA = 3, OSL = 4
const route = (persona_label, member_id, email, telegram_chat_id, extra = {}) =>
  ({ persona_label, member_id, email, telegram_chat_id, copy_all: false, is_osl_admin: false, club_ids: [], ...extra })

const rachel = route('Rachel Tan', 22, 'jerica@example.com', 101, { club_ids: [EURHYTHMIX] })
const darren = route('Darren Koh', 4, 'alicia@example.com', 102, { club_ids: [SAMBA] })
const marcus = route('Marcus Lim', 23, 'angel@example.com', 103, { club_ids: [SYMPHONIA] })
const oslAdmin = route('OSL Admin', 33, 'chloe@example.com', 104, { is_osl_admin: true, club_ids: [OSL] })
const dev = route('Dev Administrator', null, 'sarah@example.com', 105, { copy_all: true })

const realOsl = { to_emails: ['studentlife@smu.edu.sg'], cc_emails: ['eechiing@smu.edu.sg'] }
const email = (email_type) => ({ email_type, ...realOsl })

test('OSL emails reach only the OSL Admin stand-in, never real OSL staff', () => {
  for (const type of ['OSL_REQUEST', 'OSL_DEADLINE_REMINDER']) {
    const plan = resolveEmailRecipients(email(type), [rachel, darren, marcus, oslAdmin])
    assert.deepEqual(plan.to, ['chloe@example.com'])
    assert.deepEqual(plan.personas, ['OSL Admin'])
  }
})

test('a transfer confirmation reaches only the personas in the two CCAs', () => {
  const plan = resolveEmailRecipients(email('TRANSFER_CONFIRMED'), [rachel, darren, marcus, oslAdmin],
    { claimingClubId: EURHYTHMIX, releasingClubId: SAMBA })
  assert.deepEqual(plan.to, ['jerica@example.com', 'alicia@example.com'])
})

test('with no recipient configured, nobody is emailed', () => {
  assert.deepEqual(resolveEmailRecipients(email('OSL_REQUEST'), []).to, [])
  assert.deepEqual(resolveEmailRecipients(email('OSL_REQUEST'), [{ ...oslAdmin, email: null }]).to, [])
  assert.deepEqual(resolveEmailRecipients(email('TRANSFER_CONFIRMED'), [marcus], { claimingClubId: EURHYTHMIX, releasingClubId: SAMBA }).to, [])
})

test('an unknown email type goes to no persona', () => {
  assert.deepEqual(resolveEmailRecipients(email('SOMETHING_NEW'), [rachel, oslAdmin]).to, [])
})

test('a real staff or CCA address is refused even if entered as a stand-in', () => {
  const mistakes = [
    { ...oslAdmin, email: 'StudentLife@smu.edu.sg ' },
    { ...oslAdmin, email: 'eechiing@smu.edu.sg' },
    { ...oslAdmin, email: 'artsvenues@smu.edu.sg' },
    { ...oslAdmin, email: 'eurhythmix@smu.edu.sg' }
  ]
  for (const mistake of mistakes) {
    const plan = resolveEmailRecipients(email('OSL_REQUEST'), [mistake], { blocked: ['artsvenues@smu.edu.sg', 'eurhythmix@smu.edu.sg'] })
    assert.deepEqual(plan.to, [])
  }
})

test('one address standing in for two personas gets one copy, and Dev gets every email', () => {
  const shared = { ...darren, email: 'jerica@example.com' }
  const plan = resolveEmailRecipients(email('TRANSFER_CONFIRMED'), [rachel, shared, dev], { claimingClubId: EURHYTHMIX, releasingClubId: SAMBA })
  assert.deepEqual(plan.to, ['jerica@example.com', 'sarah@example.com'])
  assert.deepEqual(plan.personas, ['Rachel Tan', 'Darren Koh', 'Dev Administrator'])
  assert.deepEqual(resolveEmailRecipients(email('OSL_REQUEST'), [dev]).to, ['sarah@example.com'])
})

const alert = (recipient_member_id, title = 'Approved') => ({ recipient_member_id, type: 'TRANSFER_APPROVED', title, body: 'Studio L7.2' })
const chats = (targets) => targets.map((t) => t.chatId)

test('each persona alert reaches only that persona chat', () => {
  const routes = [rachel, darren, marcus, oslAdmin]
  for (const r of routes) {
    assert.deepEqual(resolveTelegramRecipients(alert(r.member_id), routes, null, new Set()),
      [{ chatId: String(r.telegram_chat_id), label: r.persona_label }])
  }
})

test('a member with no stand-in and no linked chat gets nothing', () => {
  assert.deepEqual(resolveTelegramRecipients(alert(999), [rachel], null, new Set()), [])
  assert.deepEqual(resolveTelegramRecipients(alert(null), [rachel], null, new Set()), [])
})

test('an explicit account link takes priority over the configured stand-in', () => {
  assert.deepEqual(chats(resolveTelegramRecipients(alert(22), [{ ...rachel, telegram_chat_id: null }], 777, new Set())), ['777'])
  assert.deepEqual(chats(resolveTelegramRecipients(alert(22), [rachel], 777, new Set())), ['777'])
})

test('personas sharing one Telegram account each get labelled alerts', () => {
  const routes = [rachel, { ...darren, telegram_chat_id: 101 }]
  assert.equal(resolveTelegramRecipients(alert(22), routes, null, new Set())[0].label, 'Rachel Tan')
  const second = resolveTelegramRecipients(alert(4), routes, null, new Set())
  assert.deepEqual(second, [{ chatId: '101', label: 'Darren Koh' }])
})

test('Dev gets one copy of an event sent to a whole CCA, and a copy of each new event', () => {
  const routes = [rachel, darren, dev]
  const seen = new Set()
  assert.deepEqual(chats(resolveTelegramRecipients(alert(22), routes, null, seen)), ['101', '105'])
  assert.deepEqual(chats(resolveTelegramRecipients(alert(4), routes, null, seen)), ['102'])
  assert.deepEqual(chats(resolveTelegramRecipients(alert(999), routes, null, seen)), [])
  assert.deepEqual(chats(resolveTelegramRecipients(alert(999, 'Rejected'), routes, null, seen)), [])
})

test('a teammate who is both Dev and a persona is not messaged twice for one alert', () => {
  const routes = [rachel, { ...dev, telegram_chat_id: 101 }]
  assert.deepEqual(chats(resolveTelegramRecipients(alert(22), routes, null, new Set())), ['101'])
})
