// Real-app facility and role browser regressions. Setup signs in through the UI;
// actions use visible controls; assertions verify current pages and permissions.
import {test,expect} from './helpers/browserUi.js'
import {signIn,navigate,fits} from './helpers/userJourney.js'

test('campus facilities and their booking rows load after one-click sign-in',async({page})=>{
 await signIn(page)
 // Facility inventory is backend data, so avoid an obsolete hardcoded room count.
 await expect(page.locator('.pulse-facility').first()).toBeVisible()
 await expect(page.locator('.pulse-facility h3').first()).not.toBeEmpty()
 await fits(page,'Facility calendar')
})

test('Marketing Director sees the role-based view-only restriction',async({page})=>{
 await signIn(page,'Marcus Lim')
 await expect(page.locator('.pulse-banner-view')).toContainText('View only')
 await expect(page.getByRole('button',{name:'Release',exact:true})).toHaveCount(0)
 await fits(page,'View-only calendar')
})

test('Day-of Operations exposes the current three schedule views',async({page})=>{
 await signIn(page)
 await navigate(page,'Day-of Operations',/Day-of Ops/)
 await expect(page).toHaveURL(/\/operations$/)
 await expect(page.getByRole('heading',{name:'Day-of Operations',exact:true})).toBeVisible()
 // Inspect real data without delaying tasks or changing attendance on a shared backend.
 for(const name of ['Full grid','Everyone now','My schedule']){
  const tab=page.getByRole('button',{name,exact:true});await tab.click();await expect(tab).toHaveClass(/active/)
  await fits(page,name)
 }
})

test('Dev Administrator can switch club context and open its personal schedule',async({page})=>{
 await signIn(page,'Dev Administrator')
 await page.locator('#clubSwitcher').selectOption('Rentak')
 await expect(page.locator('#clubSwitcher')).toHaveValue('Rentak')
 await expect(page.locator('.pulse-banner-view')).not.toBeVisible()
 await navigate(page,'Personal Schedule',/My Schedule/)
 await expect(page.getByRole('heading',{name:/here is your daily schedule/})).toBeVisible()
 await expect(page.getByText(/Rentak.*Academic Timetable/)).toBeVisible()
 await fits(page,'Administrator schedule')
})
