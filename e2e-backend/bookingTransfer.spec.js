// Complete release -> claim -> OSL approval through real pages and the real test database.
// Every stage asserts both the visible outcome and persistence after browser refresh.
import {test,expect} from './helpers/actors.js'
import {assertPageLayout} from '../e2e/helpers/browserUi.js'
async function openBooking(actor,world){
 const row=await world.booking()
 await actor.page.goto('/facilities?week='+row.booking_date)
 await expect(actor.page.getByLabel('Jump to week',{exact:true})).toHaveValue(row.booking_date)
 return actor.page.locator('.pulse-slot').filter({hasText:row.time_label})
}

test('owner releases, another club claims and OSL approves a persisted booking transfer',async({world})=>{
 // Setup: isolated authenticated accounts and the booking reserved for this viewport.
 await world.restoreBooking();world.onCleanup(()=>world.restoreBooking())
 const owner=await world.actor('owner'),claimant=await world.actor('claimant'),admin=await world.actor('admin')
 let slot=await openBooking(owner,world)
 // Actions: the owner releases using the actual confirmation dialog.
 await slot.getByRole('button',{name:'Release',exact:true}).click()
 await owner.page.getByRole('dialog',{name:'Release this slot?',exact:true}).getByRole('button',{name:'Release slot',exact:true}).click()
 // Assert: database and refreshed owner view agree about the release.
 await expect.poll(async()=>(await world.booking()).status).toBe('Proposed Peer Transfer')
 await owner.page.reload();await expect(slot).toContainText('Available to Claim')
 // Actions: a separate real account claims the released booking.
 slot=await openBooking(claimant,world)
 await slot.getByRole('button',{name:'Claim',exact:true}).click()
 await claimant.page.getByRole('dialog',{name:'Claim this slot?',exact:true}).getByRole('button',{name:'Submit claim',exact:true}).click()
 await expect.poll(async()=>(await world.booking()).status).toBe('Pending Admin Sign-off')
 const pending=await world.booking();expect(pending.claiming_club_id).toBe(10)
 await claimant.page.reload();await expect(slot).toContainText('Pending Admin Sign-off')
 // Actions: OSL approves the exact request, not whichever pending card appears first.
 await admin.page.goto('/facilities/admin')
 const review=admin.page.locator('.pulse-panel').filter({hasText:'E2E-BOOKING-'+(world.bookingId-980101)}).filter({has:admin.page.getByRole('button',{name:'Approve',exact:true})})
 await review.getByRole('button',{name:'Approve',exact:true}).click()
 await admin.page.getByRole('dialog',{name:'Approve this transfer?',exact:true}).getByRole('button',{name:'Approve transfer',exact:true}).click()
 // Assert: ownership persisted and both clubs see the approved result after reload.
 await expect.poll(async()=>{const row=await world.booking();return [row.owner_club_id,row.status]}).toEqual([10,'Officially Confirmed Booking'])
 await owner.page.reload();await claimant.page.reload()
 await expect(owner.page.locator('.pulse-slot').filter({hasText:pending.time_label})).toContainText('Confirmed')
 await expect(claimant.page.locator('.pulse-slot').filter({hasText:pending.time_label})).toContainText('Confirmed')
 const decisions=await admin.rpc('rpc_recent_transfer_decisions',{p_demo_member_id:null,p_limit:20})
 expect(decisions.some(d=>d.transfer_id===pending.transfer_id)).toBe(true)
 for(const actor of [owner,claimant,admin])await assertPageLayout(actor.page)
})

test('another club cannot release a booking or bypass its database write permissions',async({world})=>{
 // Setup: an authenticated ordinary member belongs to a different club.
 await world.restoreBooking();const outsider=await world.actor('outsider'),before=await world.booking()
 const slot=await openBooking(outsider,world)
 // Actions/Assert: forbidden actions are absent in the UI.
 await expect(slot.getByRole('button',{name:'Release',exact:true})).toHaveCount(0)
 // A forged request additionally verifies the backend, beyond hidden UI buttons.
 const denied=await outsider.rpcRaw('rpc_release_booking',{p_booking_id:world.bookingId,p_club_id:5,p_demo_member_id:(await world.actor('owner')).memberId})
 expect(denied.ok()).toBe(false);expect([400,403]).toContain(denied.status())
 const patch=await outsider.patch('facility_bookings','id=eq.'+world.bookingId,{owner_club_id:13})
 expect(patch.status()).toBe(403)
 const reset=await outsider.rpcRaw('rpc_e2e_restore_booking',{p_booking_id:world.bookingId})
 expect(reset.status(),'Staging fixture preparation must also reject other users').toBe(403)
 // Assert: a separate account reads the unchanged actual record, then the UI reloads.
 const after=await world.booking();expect([after.owner_club_id,after.status]).toEqual([before.owner_club_id,before.status])
 await outsider.page.reload();await expect(slot.getByRole('button',{name:'Release',exact:true})).toHaveCount(0)
 await assertPageLayout(outsider.page)
})
