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
