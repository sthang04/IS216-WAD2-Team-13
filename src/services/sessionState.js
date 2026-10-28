// src/services/sessionState.js
// Facility-specific session state -> stores member name, clubs and facility permissions -> these drive the facility UI
// Authentication (sign in / sign out / guest) is still owned by authService.js.
//
// Where the data comes from (Supabase):
//   auth.users -> members (auth_user_id) -> club_memberships -> exco_roles
// The view v_user_club_memberships joins these for us: one row per membership.
 
// ref() wraps a value so Vue can watch it. In JS you read and change it through .value
//   (session.value.memberName); in a template Vue unwraps it for you (session.memberName).
// computed() makes a value that is recalculated automatically whenever the data it reads changes.
import { ref, computed } from 'vue'
// The single shared Supabase client (same one authService.js uses, so they share one login)
import { supabase } from '../supabase'
// restoreSession() asks authService who is signed in (or whether they are a guest)
import { restoreSession } from './authService'
 
// Keys used to remember choices in the browser's localStorage
const DEMO_KEY = 'pulse_demo_member_id'   // demo mode: which persona was picked last
const CLUB_KEY = 'pulse_active_club_id'   // which CCA was picked in the "Acting for" menu
 
// The facility session. It starts as "Public viewer" and is filled in by initSession() below.
export const session = ref({
  ready: false,                                                // true once initSession() has finished (pages wait for this)
  demoMode: import.meta.env.VITE_PULSE_DEMO_MODE === 'true',   // read from .env; true only when testing with demo personas
  authUserId: null,                                            // the Supabase Auth user id (auth.users.id) when signed in
  memberId: null,                                              // members.id of the person using the page
  memberName: 'Public viewer',                                 // shown in the facility navbar
  isOslAdmin: false,                                           // true if their exco_roles row has is_admin_role
  memberships: [],                                             // the CCAs they belong to, each with its permission flags
  personas: [],                                                // demo mode: everyone you can switch to
  activeClubId: null                                           // the CCA picked in the "Acting for" menu
})
 
// The small pop-up message at the top of the facility pages
export const toast = ref({ message: '', type: 'info' })
 
// ---------------- Computed values (recalculate automatically) ----------------
 
// The membership for the CCA currently picked in "Acting for", or null if none.
// A plain for loop: check each membership and return the one whose club matches.
export const activeMembership = computed(() => {
  const memberships = session.value.memberships
  for (let i = 0; i < memberships.length; i++) {
    if (memberships[i].club_id === session.value.activeClubId) {
      return memberships[i]
    }
  }
  return null
})
 
// The name of that CCA, or '' if there is none
export const activeClubName = computed(() => {
  if (activeMembership.value === null) {
    return ''
  }
  return activeMembership.value.club_name
})
 
// Anyone with a membership may open My Club
export const canViewMyClub = computed(() => {
  return activeMembership.value !== null
})
 
// Only roles whose exco_roles row allows releasing or claiming (the Logistics Director)
// can act on bookings. Everyone else is view-only on the facility pages.
export const canManageActiveClub = computed(() => {
  if (activeMembership.value === null) {
    return false
  }
  return activeMembership.value.can_release_booking || activeMembership.value.can_claim_booking
})
 
// One computed per exco_roles flag, so buttons can check exactly the permission they need.
// "a !== null && a.flag" -> false when there is no membership, otherwise the flag itself.
export const canRelease = computed(() => {
  return activeMembership.value !== null && activeMembership.value.can_release_booking
})
 
export const canClaim = computed(() => {
  return activeMembership.value !== null && activeMembership.value.can_claim_booking
})
 
export const canManageWaitlist = computed(() => {
  return activeMembership.value !== null && activeMembership.value.can_manage_waitlist
})
 
export const canSendTransferEmail = computed(() => {
  return activeMembership.value !== null && activeMembership.value.can_send_transfer_email
})
 
// ---------------- Helpers ----------------
 
// The database functions (rpc_*) take an optional p_demo_member_id.
// With a real login the database works out who you are from the login itself, so we send null.
// Only in demo mode with no login do we send the chosen persona's member id.
export function demoMemberId() {
  if (session.value.authUserId) {
    return null
  }
  return session.value.memberId
}
 
// localStorage can throw an error (e.g. in a private window), so wrap it in try/catch
function readStorage(key) {
  try {
    return localStorage.getItem(key)
  } catch (error) {
    return null
  }
}
 
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    console.log(error.message)
  }
}
 
// The view v_user_club_memberships returns ONE ROW PER MEMBERSHIP.
// Someone in 2 CCAs comes back as 2 rows. This groups the rows so each person
// appears once, with a list of their CCAs inside.
function groupPersonas(rows) {
  const people = []
 
  rows.forEach((row) => {
    // Skip old memberships (club_memberships keeps history; only active ones count).
    // "return" inside forEach just skips to the next row.
    if (row.membership_is_active === false) {
      return
    }
 
    // Find this person in the list; if they aren't there yet, add them.
    // .find() returns the first item that matches, or undefined if none does.
    let person = people.find((p) => p.member_id === Number(row.member_id))
    if (!person) {
      person = {
        member_id: Number(row.member_id),   // Number() so ids compare as numbers, not text
        full_name: row.full_name,
        auth_user_id: row.user_id,
        is_osl_admin: false,
        memberships: []
      }
      people.push(person)
    }
 
    // OSL staff: their role has is_admin_role. "Office of Student Life" is not a CCA
    // they act for, so we mark them as OSL admin and don't add it to their CCA list.
    if (row.is_admin_role === true) {
      person.is_osl_admin = true
      return
    }
 
    if (row.club_id !== null) {
      // Permissions come only from the exco_roles flags, never from the role's name
      person.memberships.push({
        club_id: Number(row.club_id),
        club_name: row.club_name,
        role_name: row.role_name,       // e.g. 'Logistics Director', 'President'
        role_code: row.role_code,
        can_release_booking: row.can_release_booking === true,
        can_claim_booking: row.can_claim_booking === true,
        can_manage_waitlist: row.can_manage_waitlist === true,
        can_send_transfer_email: row.can_send_transfer_email === true,
        // shortcut used for sorting and menus: can they act at all?
        can_manage_facilities: row.can_release_booking === true || row.can_claim_booking === true
      })
    }
  })
 
  return people
}
 
// Copy one person's details into the session (or reset to "Public viewer" when person is null)
function applyMember(person) {
  if (person === null) {
    session.value.memberId = null
    session.value.memberName = 'Public viewer'
    session.value.isOslAdmin = false
    session.value.memberships = []
    session.value.activeClubId = null
    return
  }
 
  session.value.memberId = person.member_id
  session.value.memberName = person.full_name
  session.value.isOslAdmin = person.is_osl_admin
 
  // CCAs where they can act are listed first, then view-only ones.
  // concat() joins two arrays into a new one.
  const actingClubs = person.memberships.filter((m) => m.can_manage_facilities)
  const viewOnlyClubs = person.memberships.filter((m) => !m.can_manage_facilities)
  session.value.memberships = actingClubs.concat(viewOnlyClubs)
 
  // Re-open the CCA picked last time if they still belong to it;
  // otherwise the first CCA in the list; otherwise none (null)
  const savedClubId = Number(readStorage(CLUB_KEY))
  const savedClub = session.value.memberships.find((m) => m.club_id === savedClubId)
  if (savedClub) {
    session.value.activeClubId = savedClub.club_id
  } else if (session.value.memberships.length > 0) {
    session.value.activeClubId = session.value.memberships[0].club_id
  } else {
    session.value.activeClubId = null
  }
}
 
// ---------------- Loading the session ----------------
// Called when the facility pages open. Steps:
//   1. ask authService who is signed in (or whether they are a guest)
//   2. read their memberships (or the demo personas) from Supabase
//   3. group the rows into people
//   4. pick who is using the page and copy them into session
export async function initSession() {
  session.value.ready = false
 
  try {
    // Step 1: the team's authService decides who is signed in
    const teamPersona = await restoreSession()
 
    // A guest can only look. Stop here so demo mode can never hand a guest
    // a Logistics Director's permissions. (finally below still sets ready.)
    if (teamPersona && teamPersona.role === 'guest') {
      session.value.authUserId = null
      session.value.personas = []
      applyMember(null)
      return
    }
 
    // No Supabase keys (supabase.js exports null): the facility calendar needs
    // the database, so everyone is a Public viewer. Stop before any supabase call.
    if (!supabase) {
      session.value.authUserId = null
      session.value.personas = []
      applyMember(null)
      return
    }
 
    // Also get the Supabase login itself, for its user id
    const authResponse = await supabase.auth.getSession()
    if (authResponse.error) {
      throw authResponse.error
    }
    // Only a real signed-in person (teamPersona is not null) gets an authUserId
    if (teamPersona && authResponse.data.session) {
      session.value.authUserId = authResponse.data.session.user.id
    } else {
      session.value.authUserId = null
    }
 
    // Step 2: read the rows
    let rows = []
    if (session.value.authUserId) {
      // Signed in: their own memberships, joined to exco_roles by the view.
      // Row-level security in the database only returns this person's rows.
      const response = await supabase
        .from('v_user_club_memberships')
        .select('*')
        .eq('user_id', session.value.authUserId)
      if (response.error) {
        throw response.error
      }
      rows = response.data
    } else if (session.value.demoMode) {
      // Demo / testing only: every demo persona, so you can switch between them.
      // This is not a security feature; the database still checks every action.
      const response = await supabase
        .from('v_demo_personas')
        .select('*')
        .order('full_name')
      if (response.error) {
        throw response.error
      }
      rows = response.data
    }
 
    // Step 3: one entry per person
    session.value.personas = groupPersonas(rows)
 
    // Step 4: choose who is using the page
    if (session.value.authUserId) {
      // Signed in: the person whose login matches
      const me = session.value.personas.find((p) => p.auth_user_id === session.value.authUserId)
      applyMember(me || null)
    } else if (session.value.demoMode) {
      // Demo: the persona picked last time, else Darren Koh, else any Logistics Director.
      // .some() is true if at least one item in the list matches.
      const savedId = Number(readStorage(DEMO_KEY))
      let chosen = session.value.personas.find((p) => p.member_id === savedId)
      if (!chosen) {
        chosen = session.value.personas.find((p) => {
          return p.full_name === 'Darren Koh' && p.memberships.some((m) => m.can_manage_facilities)
        })
      }
      if (!chosen) {
        chosen = session.value.personas.find((p) => p.memberships.some((m) => m.can_manage_facilities))
      }
      applyMember(chosen || null)
    } else {
      // Not signed in and not demo: public viewer
      applyMember(null)
    }
  } catch (error) {
    // Anything failed: fall back to a safe "Public viewer" with no permissions,
    // then rethrow so the page can show an error message
    console.log(error.message)
    session.value.authUserId = null
    session.value.personas = []
    applyMember(null)
    throw error
  } finally {
    // finally always runs (success, error or return), so pages never wait forever
    session.value.ready = true
  }
}
 
// Demo mode only: act as a different persona (ignored when someone is really signed in)
export function switchPersona(memberId) {
  if (!session.value.demoMode || session.value.authUserId) {
    return
  }
 
  const person = session.value.personas.find((p) => p.member_id === Number(memberId))
  if (!person) {
    console.log('Demo persona not found: ' + memberId)
    return
  }
 
  // Forget the old persona's CCA so it isn't carried over to the new one
  try {
    localStorage.removeItem(CLUB_KEY)
  } catch (error) {
    console.log(error.message)
  }
 
  writeStorage(DEMO_KEY, String(person.member_id))
  applyMember(person)
}
 
// "Acting for" menu: switch CCA, but only to one this person belongs to
export function setActiveClub(clubId) {
  const id = Number(clubId)
  const belongs = session.value.memberships.some((m) => m.club_id === id)
  if (!belongs) {
    return
  }
  session.value.activeClubId = id
  writeStorage(CLUB_KEY, String(id))   // remember it for next time
}
 
let toastTimer = null
 
// Show a pop-up message. type is 'info', 'success' or 'danger' (Bootstrap colour names).
// "type = 'info'" is a DEFAULT PARAMETER: used when showToast is called without a type.
export function showToast(message, type = 'info') {
  toast.value.message = message
  toast.value.type = type
 
  // Errors stay a little longer so they can be read
  let seconds = 5
  if (type === 'danger') {
    seconds = 9
  }
  // Cancel the previous hide timer so a new message gets its full time on screen
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value.message = ''
  }, seconds * 1000)
}
 
// Reload the facility session when someone signs in or out anywhere in the app.
// onAuthStateChange runs our function on every login event of the shared Supabase client.
// supabase is null when the keys are missing, so only listen when it exists.
if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (session.value.ready && (event === 'SIGNED_IN' || event === 'SIGNED_OUT')) {
      // Supabase can freeze if we make another Supabase call INSIDE this callback.
      // setTimeout(..., 0) runs initSession just after the callback has finished, which avoids that.
      setTimeout(() => {
        initSession().catch((error) => console.log(error.message))
      }, 0)
    }
  })
}
 