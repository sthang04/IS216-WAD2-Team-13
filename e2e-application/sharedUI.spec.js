// BROWSER TEST PURPOSE: shared UI user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
import {test,expect} from './fixtures/app.js'
import {room} from './fixtures/journeys.js'

test('keyboard confirms a reviewed booking action and dismisses its feedback',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 await room(page,'Fixture Dance Studio').getByRole('button',{name:'Release',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Release this slot?',exact:true})
 await dialog.getByRole('button',{name:'Release slot',exact:true}).focus()
 await page.keyboard.press('Enter')
 await expect(room(page,'Fixture Dance Studio')).toContainText('Available to Claim')
 const toast=page.getByRole('status').filter({hasText:'Released.'})
 await toast.getByRole('button',{name:'Dismiss',exact:true}).click()
 await expect(toast).toHaveCount(0)
})

test('Escape cancels a booking confirmation without releasing the slot',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 await room(page,'Fixture Dance Studio').getByRole('button',{name:'Release',exact:true}).click()
 await page.keyboard.press('Escape')
 // Escape must cancel the idle dialog without changing the booking.
 await expect(page.getByRole('dialog',{name:'Release this slot?',exact:true})).toHaveCount(0)
 await expect(room(page,'Fixture Dance Studio').getByRole('button',{name:'Release',exact:true})).toBeVisible()
})

test('Pip opens actual notifications and settings persist across reload',async({page,app})=>{
 // Use the supported OS reduced-motion preference to operate the animated target.
 await page.emulateMedia({reducedMotion:'reduce'})
 await app.open('/facilities',{authenticated:true,notifications:true})
 const pip=page.getByRole('button',{name:/^Pip assistant/})
 await pip.click()
 await page.getByRole('button',{name:'Open notifications',exact:true}).click()
 await expect(page.getByRole('button',{name:/Fixture schedule update/})).toBeVisible()
 await page.keyboard.press('Escape')
 await pip.click({button:'right'})
 await page.getByRole('menuitemradio',{name:'Keep Pip still',exact:true}).click()
 await pip.click({button:'right'})
 await page.getByRole('menuitemcheckbox',{name:'Hide speech bubble',exact:true}).click()
 // Restore normal motion before reload so the saved setting, not the OS preference, is verified.
 await page.emulateMedia({reducedMotion:'no-preference'})
 await page.reload()
 await expect(page.locator('.pip-button')).toHaveCSS('animation-name','none')
 await expect(page.locator('.pip-speech')).toHaveCount(0)
})

test('facility loading state resolves after a controlled local query',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true,holdTable:'facilities'})
 await expect(page.getByText(/Loading facility data/)).toBeVisible()
 await page.evaluate(()=>{window.__foundation.configure({holdTable:null});window.__foundation.release()})
 await expect(room(page,'Fixture Music Room')).toBeVisible()
 await expect(page.getByText(/Loading facility data/)).toHaveCount(0)
})
