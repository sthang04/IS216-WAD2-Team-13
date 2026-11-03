import {test,expect} from '@playwright/test'
import {bootRecovery,confirmRecovery} from './helpers/recoveryHarness.js'
async function facility(page,{linked=false,status='Pending Admin Sign-off',action='Pending Approval',otherEventBooking=false}={}){
 const panel=await bootRecovery(page,{acknowledge:false,invitationsEnabled:true,otherEventBooking})
 await page.evaluate(({linked,status,action})=>{const d=window.__localDb,b=d.facility_bookings[0];b.status=status;window.__localPlan.changes.push({segmentId:1,venueName:d.facilities.find(f=>f.id===b.facility_id).name,...(linked?{facilityBookingId:b.id}:{})});window.__localPlan.actions.push({kind:'Room',segmentId:1,status:action})},{linked,status,action})
 await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click();await panel.getByRole('tab',{name:/Facility approval/}).click();return panel
}
const card=panel=>panel.getByRole('article',{name:/Booking requirement/})
test('unlinked card keeps lookup collapsed and sends exact activity context to calendar',async({page},info)=>{
 const panel=await facility(page),c=card(panel)
 await expect(c).toContainText('Booking not linked');await expect(c.locator('select')).toBeHidden()
 const href=await c.getByRole('link',{name:'Request this facility',exact:true}).getAttribute('href'),url=new URL(href,'http://fixture')
 expect(url.pathname).toBe('/facilities');expect(url.searchParams.get('simFacility')).toBe('Fixture Original Room');expect(url.searchParams.get('simStart')).toContain('2026-11-02');expect(url.searchParams.get('simRecoveryToken')).toBeTruthy()
 await c.screenshot({path:info.outputPath('facility-unlinked.png')})
})
for(const [status,action,label] of [['Pending Admin Sign-off','Pending Approval','Waiting for facility approval'],['Officially Confirmed Booking','Approved','Booking approved'],['Rejected','Not Approved','Booking rejected']])test('linked '+status+' is actual status, not recovery readiness',async({page},info)=>{
 const panel=await facility(page,{linked:true,status,action}),c=card(panel)
 await expect(c).toContainText(label);await expect(c.locator('select')).toBeHidden();await expect(c.getByText('Linked',{exact:true})).toBeVisible()
 await c.getByText('View booking details',{exact:true}).click();await expect(c).toContainText(status)
 await c.screenshot({path:info.outputPath('facility-status.png')})
 await panel.getByRole('tab',{name:/Apply \/ Undo/}).click();await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeDisabled()
})
test('exact successful claim offers confirmed association; a lone visible match never auto-links',async({page})=>{
 const panel=await facility(page),c=card(panel),href=await c.getByRole('link',{name:'Request this facility',exact:true}).getAttribute('href')
 await expect(c.getByRole('button',{name:'Confirm booking link',exact:true})).toHaveCount(0)
 await page.evaluate(async href=>{const {reportRecoveryBookingClaim}=await import('/src/services/simulatorBookingBridge.js');const token=new URL(href,location.origin).searchParams.get('simRecoveryToken');reportRecoveryBookingClaim({simRecoveryToken:token},window.__localDb.facility_bookings[0].id,1)},href)
 await expect(c.getByRole('button',{name:'Confirm booking link',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>window.__localCalls.filter(c=>c.name==='rpc_simulator_attach_booking'))).toEqual([])
 await c.getByRole('button',{name:'Confirm booking link',exact:true}).click();await expect(panel.getByRole('dialog')).toBeVisible();await confirmRecovery(panel)
 await expect(c.getByText('Linked',{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>window.__localCalls.filter(c=>c.name==='rpc_simulator_attach_booking').length)).toBe(1)
})
test('manual fallback filters room, owner and complete time coverage; linking still requires confirmation',async({page})=>{
 const panel=await facility(page,{otherEventBooking:true}),c=card(panel)
 await page.evaluate(()=>{const d=window.__localDb,b=d.facility_bookings[0];d.facility_bookings.push({...b,id:701,start_time:'23:00:00'},{...b,id:702,booking_date:'2026-12-01'},{...b,id:703,owner_club_id:999},{...b,id:704});})
 await panel.getByRole('button',{name:'Refresh booking records',exact:true}).click();await c.getByText(/Can't find your booking/).click()
 const options=await c.locator('select option').allTextContents();expect(options.join(' ')).not.toMatch(/Booking 70[1235]/);expect(options.join(' ')).toContain('Booking 704')
 await c.locator('select').selectOption('704');expect(await page.evaluate(()=>window.__localPlan.changes.some(c=>c.facilityBookingId===704))).toBe(false)
 await c.getByRole('button',{name:'Associate calendar booking',exact:true}).click();await panel.getByRole('dialog').getByRole('button',{name:'Dismiss action',exact:true}).click()
 expect(await page.evaluate(()=>window.__localCalls.filter(c=>c.name==='rpc_simulator_attach_booking'))).toEqual([])
})
test('return refresh preserves selection and missing or inaccessible records never become approved',async({page})=>{
 const panel=await facility(page,{linked:true,status:'Officially Confirmed Booking',action:'Approved'}),c=card(panel)
 const selected=await panel.getAttribute('data-selected-recovery')
 await page.evaluate(()=>{window.__localDb.facility_bookings=[];window.dispatchEvent(new Event('focus'))})
 await expect(c).toContainText('Unable to verify');await expect(panel).toHaveAttribute('data-selected-recovery',selected)
 await page.evaluate(()=>{window.__bookingReadError='Permission denied';window.dispatchEvent(new Event('focus'))})
 await expect(panel.getByRole('status').filter({hasText:'Unable to refresh bookings'})).toContainText('Permission denied')
 await expect(c).toContainText('Unable to verify')
})

test('pending transfer ownership and actual rejection remain distinct from approval',async({page})=>{
 const panel=await facility(page,{linked:true}),c=card(panel)
 await page.evaluate(()=>{const b=window.__localDb.facility_bookings[0];b.owner_club_id=99;b.recovery_transfers=[{id:10,booking_id:b.id,claiming_club_id:1,transfer_status:'Pending Admin Sign-off'}]})
 await panel.getByRole('button',{name:'Refresh booking records',exact:true}).click();await expect(c).toContainText('Waiting for facility approval')
 await page.evaluate(()=>{const b=window.__localDb.facility_bookings[0];b.status='Proposed Peer Transfer';b.recovery_transfers[0].transfer_status='Rejected'})
 await panel.getByRole('button',{name:'Refresh booking records',exact:true}).click();await expect(c).toContainText('Booking rejected')
 await page.evaluate(()=>window.__localDb.facility_bookings[0].recovery_transfers.push({id:11,claiming_club_id:1,transfer_status:'Rejected'}))
 await panel.getByRole('button',{name:'Refresh booking records',exact:true}).click();await expect(c).toContainText('Unable to verify')
})

test('tagged calendar round trip preserves the selected saved recovery and refreshes on return',async({page})=>{
 const panel=await bootRecovery(page,{acknowledge:false,invitationsEnabled:true,lifecycle:'pane'})
 await page.evaluate(()=>{const d=window.__localDb,b=d.facility_bookings[0];window.__localPlan.changes.push({segmentId:1,venueName:d.facilities.find(f=>f.id===b.facility_id).name})})
 await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click();await panel.getByRole('tab',{name:/Facility approval/}).click()
 const selected=await panel.getAttribute('data-selected-recovery'),reads=await page.evaluate(()=>window.__bookingReads||0)
 await panel.getByRole('link',{name:'Request this facility',exact:true}).click();await expect(page.getByText('Away from simulator',{exact:true})).toBeVisible()
 await page.evaluate(async()=>{const {reportRecoveryBookingClaim}=await import('/src/services/simulatorBookingBridge.js');reportRecoveryBookingClaim(window.__simRouter.currentRoute.value.query,1,1);await window.__simRouter.push('/')})
 await expect(panel).toBeVisible();await expect(panel).toHaveAttribute('data-selected-recovery',selected)
 await expect.poll(()=>page.evaluate(()=>window.__bookingReads||0)).toBeGreaterThan(reads)
 await expect(panel.getByRole('button',{name:'Confirm booking link',exact:true})).toBeVisible()
})

test('association denial leaves the booking unlinked and denied history disables linking',async({page})=>{
 const panel=await facility(page),c=card(panel)
 await c.getByText(/Can't find your booking/).click();await c.locator('select').selectOption('1')
 await page.evaluate(()=>{window.__denyOperation=true})
 await c.getByRole('button',{name:'Associate calendar booking',exact:true}).click();await confirmRecovery(panel)
 await expect(panel.getByRole('alert')).toContainText('permission required')
 expect(await page.evaluate(()=>window.__localPlan.changes.some(c=>c.facilityBookingId))).toBe(false)
 await page.evaluate(()=>{window.__denyHistory=true})
 await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click()
 await expect(c).toContainText('Unable to verify');await expect(c.getByRole('button',{name:'Associate calendar booking',exact:true})).toBeDisabled()
})
