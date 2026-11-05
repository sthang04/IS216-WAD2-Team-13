// Reviewed screenshot comparisons supplement the lecture's user-workflow assertions.
// API fixtures stabilize data; screenshots validate rendering, not live backend writes.
import {test,expect} from './fixtures/app.js'
import {scheduleCard,room} from './fixtures/journeys.js'
import {assertSingleLineText} from '../e2e/helpers/browserUi.js'
const size=page=>page.viewportSize().width+'x'+page.viewportSize().height
const screenshotOptions={animations:'disabled',caret:'hide',scale:'css',maxDiffPixelRatio:0.001}

test('visual regression: sample schedule card retains readable status states',async({page,app})=>{
 // Setup: reduced motion, fixed fixture time and stable sample data.
 await page.emulateMedia({reducedMotion:'reduce'});await app.open('/personal-schedule',{authenticated:true})
 const card=scheduleCard(page,'IS216 Web Application Development II (G1)'),status=card.locator('.schedule-entry-status')
 for(const name of ['Completed','Not Started','In Progress']){
  // Actions: cycle the real status control and bring the complete card into view.
  await expect(status).toHaveText(name);await card.scrollIntoViewIfNeeded()
  // Assert: semantic checks accompany the reviewed pixel baseline.
  await assertSingleLineText(status,'Schedule '+name)
  await expect(card).toHaveScreenshot('schedule-'+name.replaceAll(' ','-').toLowerCase()+'-'+size(page)+'.png',screenshotOptions)
  await status.click()
 }
})

test('visual regression: open notifications retain their heading, content and actions',async({page,app})=>{
 // Setup: controlled unread notifications on the actual calendar page.
 await page.emulateMedia({reducedMotion:'reduce'});await app.open('/facilities',{authenticated:true,notifications:true})
 // Actions: open the real notification panel.
 await page.getByRole('button',{name:/^Notifications, [0-9]+ unread$/}).click()
 const panel=page.getByRole('region',{name:'Notifications',exact:true})
 // Assert: expected content and the reviewed panel appearance are both present.
 await expect(panel.getByRole('button',{name:'Clear all',exact:true})).toBeVisible()
 await expect(panel).toHaveScreenshot('notifications-'+size(page)+'.png',screenshotOptions)
 await panel.getByRole('button',{name:'Close notifications',exact:true}).click()
})


test('visual regression: booking confirmation presents readable details and actions',async({page,app})=>{
 // Setup: open a claimable synthetic booking in the real facility calendar.
 await page.emulateMedia({reducedMotion:'reduce'});await app.open('/facilities',{authenticated:true,facilities:true})
 // Actions: follow the Claim action into its actual confirmation dialog.
 await room(page,'Fixture Music Room').getByRole('button',{name:'Claim',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Claim this slot?',exact:true})
 // Assert: the intended booking and both actions accompany the reviewed image.
 await expect(dialog).toContainText('Fixture Music Room')
 await expect(dialog.getByRole('button',{name:'Submit claim',exact:true})).toBeEnabled()
 await expect(dialog).toHaveScreenshot('booking-confirmation-'+size(page)+'.png',screenshotOptions)
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
})

test('visual regression: meeting form retains participant, title and deadline controls',async({page,app})=>{
 // Setup: an empty controlled meeting week avoids changes to real participants.
 await page.emulateMedia({reducedMotion:'reduce'});await app.open('/availability',{authenticated:true,meetings:true,emptyMeeting:true})
 // Actions: open and populate the real meeting request form.
 await page.getByRole('button',{name:'Schedule Meeting',exact:true}).click()
 await page.getByLabel('Title',{exact:true}).fill('Visual planning meeting')
 await page.getByRole('button',{name:'Everyone',exact:true}).click()
 const form=page.locator('form').filter({has:page.getByLabel('Title',{exact:true})})
 // Assert: expected fields and the reviewed form appearance are both present.
 await expect(form.getByLabel('Voting deadline',{exact:true})).toBeVisible()
 await expect(form).toHaveScreenshot('meeting-form-'+size(page)+'.png',screenshotOptions)
 await form.getByRole('button',{name:'Close',exact:true}).click()
})
