// WHY THIS IS NOT A PLAYWRIGHT TEST: handleMismatchNote is a pure string helper used by the
// telegram-webhook Edge Function (Deno, server-side). No browser page ever renders it, so a
// Playwright journey cannot reach it; node:test checks its handle-normalisation edge cases directly.
// SCOPE: Node unit tests (node:test); run with `pnpm test:unit`. Excluded from browser E2E commands.
// A pass here does not prove Telegram delivery or the deployed webhook.
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleMismatchNote } from '../../supabase/functions/_shared/telegramLink.js'

test('no note when the Telegram account matches the sign-up handle', () => {
  assert.equal(handleMismatchNote('RachelTan', 'racheltan'), '')
  assert.equal(handleMismatchNote('@racheltan', 'racheltan'), '')
})

test('no note when the account never saved a handle', () => {
  assert.equal(handleMismatchNote(null, 'racheltan'), '')
  assert.equal(handleMismatchNote('  ', ''), '')
})

test('warns about a different username', () => {
  const note = handleMismatchNote('racheltan', 'someoneelse')
  assert.match(note, /@racheltan/)
  assert.match(note, /@someoneelse/)
  assert.match(note, /\/stop/)
})

test('warns when the Telegram account has no username', () => {
  assert.match(handleMismatchNote('racheltan', ''), /has no username/)
})
