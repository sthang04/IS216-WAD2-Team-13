
// One router for the whole Pulse app, so every page has its own URL and a
// refresh stays on the same page.
//
// The URLs are the ones the team chose (/availability, /events, ...). The team
// pages are still drawn by App.vue from currentView (with the props it passes
// them); their routes only carry meta.view and App.vue keeps currentView and
// the URL in step. The facility pages render
// through <RouterView> inside App.vue's facilities pane.
import { createRouter, createWebHistory } from 'vue-router'
import { restoreSession, currentSessionPersona, canOpenView, homeView } from '../services/authService'

import FacilityCalendarLayout from '../views/FacilityCalendarLayout.vue'
import MasterFacilityCalendarView from '../views/MasterFacilityCalendarView.vue'
import MyClubView from '../views/MyClubView.vue'
import WaitlistView from '../views/WaitlistView.vue'
import OslTransferApprovalsView from '../views/OslTransferApprovalsView.vue'

// Placeholder for routes whose page App.vue draws itself.
const AppPane = { render: () => null }

// currentView name <-> URL
export const VIEW_PATHS = {
  landing: '/',
  admin: '/admin',
  facilities: '/facilities',
  schedule: '/personal-schedule',
  heatmap: '/availability',
  operations: '/operations',
  risk: '/events'
}

const routes = [
  { path: '/', name: 'landing', component: AppPane, meta: { view: 'landing', public: true } },
  { path: '/signup', name: 'signup', component: AppPane, meta: { view: 'landing', public: true, signup: true } },
  { path: '/admin', name: 'admin', component: AppPane, meta: { view: 'admin' } },
  {
    path: '/facilities',
    component: FacilityCalendarLayout,
    meta: { view: 'facilities' },
    children: [
      { path: '', name: 'facilities', component: MasterFacilityCalendarView },
      { path: 'my-club', name: 'facilities-my-club', component: MyClubView },
      { path: 'waitlist', name: 'facilities-waitlist', component: WaitlistView },
      // Hiding the link is not security: every OSL query and action is re-checked by the database.
      { path: 'admin', name: 'facilities-admin', component: OslTransferApprovalsView, meta: { oslOnly: true } }
    ]
  },
  { path: '/personal-schedule', name: 'personal-schedule', component: AppPane, meta: { view: 'schedule' } },
  { path: '/availability', name: 'availability', component: AppPane, meta: { view: 'heatmap' } },
  { path: '/operations', name: 'operations', component: AppPane, meta: { view: 'operations' } },
  { path: '/events', name: 'events', component: AppPane, meta: { view: 'risk' } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Restore the saved sign-in once, before the first page is chosen

// to.meta.oslOnly -> Checks whether the route is restricted to OSL


let restored = null

router.beforeEach(async (to) => {
  if (!restored) restored = restoreSession().catch(() => null)
  await restored
  if (to.meta.public) return true

  const persona = currentSessionPersona()
  if (!persona) return { path: '/', query: { redirect: to.fullPath } }
  if (!canOpenView(persona, to.meta.view)) return VIEW_PATHS[homeView(persona)]
  if (to.meta.oslOnly && persona.role !== 'admin' && !persona.isDev) return '/facilities'
  return true
})

export default router
