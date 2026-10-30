
// Notifications and waitlist offers shared by the bell and Pip,
// so both always show the same numbers.
 
import { ref, computed } from 'vue'
import { session, canManageActiveClub } from './sessionState'
import { fetchMyNotifications, listenForNotifications, deleteNotifications, NOTIFICATION_LIMIT } from './notificationService'
import { fetchActiveClubEntries, secondsLeft, listenForClubWaitlist } from './waitlistService'
 
const PIP_STATIC_KEY = 'pulse_pip_static'
const PIP_QUIET_KEY = 'pulse_pip_quiet'
 
// Pip's right-click choices are remembered in this browser
function readFlag(key) {
  try {
    return localStorage.getItem(key) === 'true'
  } catch (error) {
    return false
  }
}
 
function writeFlag(key, value) {
  try {
    localStorage.setItem(key, String(value))
  } catch (error) {
    console.log(error.message)
  }
}
 
// In the template: notificationStore.items. In JS: notificationStore.value.items
export const notificationStore = ref({
  items: [],      // the member's notifications
  offers: [],     // waitlist offers the active CCA is holding
  bellOpen: false,
  ringTick: 0,    // goes up by 1 whenever the bell should ring
  pipStatic: readFlag(PIP_STATIC_KEY),
  pipQuiet: readFlag(PIP_QUIET_KEY),  // true = hide Pip's speech bubble
  now: Date.now() // updated every second while an offer countdown is showing
})
 
export const unreadCount = computed(() => {
  let count = 0
  notificationStore.value.items.forEach((item) => {
    if (!item.is_read) {
      count += 1
    }
  })
  return count
})
 
// True when the bell is showing the maximum number of notifications,
// which means older ones exist but were not loaded. Pip tells the user.
export const notificationListIsFull = computed(() => {
  return notificationStore.value.items.length >= NOTIFICATION_LIMIT
})
 
// Seconds left on the most urgent offer, or null when there is none
export const soonestOfferSeconds = computed(() => {
  let soonest = null
  notificationStore.value.offers.forEach((offer) => {
    const seconds = secondsLeft(offer.offer_expires_at, notificationStore.value.now)
    if (seconds > 0 && (soonest === null || seconds < soonest)) {
      soonest = seconds
    }
  })
  return soonest
})
 
// The bell rings once per visit, the first time there are unread notifications
let hasRung = false
 
export async function loadNotifications() {
  if (!session.value.memberId) {
    notificationStore.value.items = []
    return
  }
  try {
    notificationStore.value.items = await fetchMyNotifications()
    if (!hasRung && unreadCount.value > 0) {
      hasRung = true
      notificationStore.value.ringTick += 1
    }
  } catch (error) {
    console.log(error.message)
  }
}
 
// Only people who can accept an offer need to see it
export async function loadOffers() {
  if (!session.value.activeClubId || !canManageActiveClub.value) {
    notificationStore.value.offers = []
    updateCountdownClock()
    return
  }
  try {
    const entries = await fetchActiveClubEntries(session.value.activeClubId)
    notificationStore.value.offers = entries.filter((entry) => entry.status === 'OFFERED')
  } catch (error) {
    console.log(error.message)
  }
  updateCountdownClock()
}
 
export function reloadAll() {
  return Promise.all([loadNotifications(), loadOffers()])
}
 
// Remove from the list straight away; put it back if the database refuses
export async function removeNotification(id) {
  const before = notificationStore.value.items
  notificationStore.value.items = before.filter((item) => item.id !== id)
  try {
    await deleteNotifications(id)
  } catch (error) {
    notificationStore.value.items = before
    throw error
  }
}
 
export async function clearAllNotifications() {
  const before = notificationStore.value.items
  notificationStore.value.items = []
  try {
    await deleteNotifications(null)
  } catch (error) {
    notificationStore.value.items = before
    throw error
  }
}
 
export function setPipStatic(value) {
  notificationStore.value.pipStatic = value
  writeFlag(PIP_STATIC_KEY, value)
}
 
export function setPipQuiet(value) {
  notificationStore.value.pipQuiet = value
  writeFlag(PIP_QUIET_KEY, value)
}
 
// ---------------- Live updates ----------------
 
let stopNotificationListener = null
let stopOfferListener = null
let countdownClock = null
let safetyTimer = null
 
// Tick once a second, but only while there is an offer countdown to show
function updateCountdownClock() {
  clearInterval(countdownClock)
  countdownClock = null
  if (notificationStore.value.offers.length > 0) {
    notificationStore.value.now = Date.now()
    countdownClock = setInterval(() => {
      notificationStore.value.now = Date.now()
    }, 1000)
  }
}
 
// Call this after the session loads, and again whenever the person or the
// "Acting for" CCA changes. It reloads everything and listens for changes.
export function startNotifications() {
  // Step 1: stop listening for the previous person / CCA
  if (stopNotificationListener) {
    stopNotificationListener()
    stopNotificationListener = null
  }
  if (stopOfferListener) {
    stopOfferListener()
    stopOfferListener = null
  }
  notificationStore.value.bellOpen = false
 
  // Step 2: load the current data
  reloadAll()
 
  // Step 3: listen for new notifications for this member
  if (session.value.memberId) {
    stopNotificationListener = listenForNotifications(session.value.memberId, async () => {
      await reloadAll()
      notificationStore.value.ringTick += 1
    })
  }
 
  // Step 4: listen for waitlist changes for this CCA
  if (session.value.activeClubId) {
    stopOfferListener = listenForClubWaitlist(session.value.activeClubId, loadOffers)
  }
 
  // Step 5: check offers every 30 seconds in case a live update was missed
  if (safetyTimer === null) {
    safetyTimer = setInterval(loadOffers, 30000)
  }
}
 