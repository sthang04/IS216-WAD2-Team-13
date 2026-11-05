// Shared top-level navigation used by every browser suite (fixture and live backend).
// Follows the control a real user sees at the current viewport:
//  - Desktop (>= 992px): the header pills. Their text shortens below 1400px
//    ("Schedule" instead of "Personal Schedule"), so names accept both forms.
//  - Phones/tablets (< 992px): the ☰ "Toggle Navigation Menu" button opens the
//    slide-out drawer, whose links always use the full feature names.
// Scoping each click to the header or the drawer keeps locators unambiguous,
// because both menus contain a button for every page.
import {expect} from '@playwright/test'

// currentView key -> full feature name shown in the drawer (and wide desktop header)
const FULL_NAMES={
 facilities:'Master Facility Calendar',
 schedule:'Personal Schedule',
 heatmap:'Availability Heatmap',
 operations:'Day-of Operations',
 risk:'Event Risk Planning',
 review:'OSL Review',
}
// Full name -> pattern matching both the long and the compact desktop pill text
const DESKTOP_PATTERNS={
 'Master Facility Calendar':/^(Master )?Facility Calendar$/,
 'Personal Schedule':/^(Personal )?Schedule$/,
 'Availability Heatmap':/^(Availability )?Heatmap$/,
 'Day-of Operations':/^(Day-of )?Operations$/,
 'Event Risk Planning':/^(Event )?Risk Planning$/,
 'OSL Review':/^OSL Review$/,
}

// view: a currentView key ('schedule') or a full feature name ('Personal Schedule').
export async function openPage(page,view,fallbackLabel){
 const name=FULL_NAMES[view]||view||fallbackLabel
 const toggle=page.getByRole('button',{name:'Toggle Navigation Menu',exact:true})
 if(await toggle.isVisible()){
  // Mobile: open the drawer, then pick the page from inside it.
  await toggle.click()
  const drawer=page.getByRole('complementary',{name:'Navigation menu',exact:true})
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button',{name,exact:true}).click()
  // Choosing a page closes the drawer again.
  await expect(toggle).toHaveAttribute('aria-expanded','false')
 }else{
  // Desktop: the header pills (class pulse-nav-pill) live in the page header, outside the drawer.
  await page.locator('header').getByRole('button',{name:DESKTOP_PATTERNS[name]||name}).click()
 }
}
