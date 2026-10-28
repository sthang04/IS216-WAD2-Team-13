
// Login, session persistence and role-based permission checks for SMU Pulse
//
// Where a signed-in person's details come from (Supabase):
//   auth.users -> members (auth_user_id) -> club_memberships -> exco_roles
// The view v_user_club_memberships joins these: one row per CCA membership.
// The old exco_members table is no longer read here.
 
import { supabase, isSupabaseConfigured } from '../supabase'
import { DEMO_PERSONAS, GUEST_PERSONA, DEMO_PASSWORD } from './authProfiles'
 
// Used for guest mode, and for the whole session when Supabase isn't configured
const LOCAL_SESSION_KEY = 'pulse_session'
const SMU_EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)*smu\.edu\.sg$/i
 
const NOT_EXCO_MESSAGE = 'Pulse sign-in is for CCA ExCos and OSL staff. Explore as a guest to view venues.'
 
// Pages each role may open
const VIEWS_BY_ROLE = {
  admin: ['admin', 'facilities', 'heatmap'],
  club: ['facilities', 'schedule', 'heatmap', 'operations', 'risk'],
  dev: ['facilities', 'schedule', 'heatmap', 'operations', 'risk'],
  guest: ['facilities', 'schedule', 'heatmap', 'operations', 'risk'] // read-only
}
 
// Who actually signed in
let sessionPersona = null
 
// ---------------- Browser storage ----------------
 
function readLocalSession() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY))
  } catch (error) {
    return null
  }
}
 
function writeLocalSession(value) {
  try {
    if (value) {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(value))
    } else {
      localStorage.removeItem(LOCAL_SESSION_KEY)
    }
  } catch (error) {
    // Storage blocked (e.g. private window): the session just won't survive a refresh
    console.log(error.message)
  }
}
 
export function isSmuEmail(email) {
  return SMU_EMAIL_PATTERN.test((email || '').trim())
}
 
// Demo accounts: only used for their display details (sector, smart searches),
// and for signing in when Supabase isn't configured
export function findPersonaByEmail(email) {
  const normalized = (email || '').trim().toLowerCase()
  const personas = Object.values(DEMO_PERSONAS)
  for (let i = 0; i < personas.length; i++) {
    if (personas[i].email === normalized) {
      return personas[i]
    }
  }
  return null
}
 
// ---------------- Reading the database ----------------
 
// The signed-in person's active CCA memberships (row-level security only returns their own)
async function fetchMembershipRows(authUserId) {
  const response = await supabase
    .from('v_user_club_memberships')
    .select('*')
    .eq('user_id', authUserId)
    .order('club_name')
  if (response.error) {
    throw response.error
  }
 
  const rows = []
  response.data.forEach((row) => {
    if (row.membership_is_active !== false && row.club_id !== null) {
      rows.push(row)
    }
  })
  return rows
}
 
// Turn the membership rows into the persona object the rest of the app uses.
// It has the same fields as the personas in authProfiles.js.
function personaFromRows(rows, email) {
  const first = rows[0]
  const demo = findPersonaByEmail(email)
 
  // OSL staff: their exco_roles row has is_admin_role
  let isAdmin = false
  rows.forEach((row) => {
    if (row.is_admin_role === true) {
      isAdmin = true
    }
  })
 
  // CCAs and the role title held in each, e.g. { Symphonia: 'President' }
  const ccas = []
  const positions = {}
  rows.forEach((row) => {
    ccas.push(row.club_name)
    positions[row.club_name] = row.role_name
  })
 
  // Label shown under the name, e.g. 'Eurhythmix Logistics Director'
  let roleLabel = ''
  if (isAdmin) {
    roleLabel = 'OSL Facility Administrator'
  } else if (ccas.length > 1) {
    roleLabel = 'ExCo (' + ccas.join(' & ') + ')'
  } else {
    roleLabel = first.club_name + ' ' + first.role_name
  }
 
  let role = 'club'
  if (isAdmin) {
    role = 'admin'
  }
 
  let sector = 'ACF • Arts & Culture'
  let smartSearches = ['All Venues', 'Dance Studio', 'Acoustic Room']
  if (isAdmin) {
    sector = 'Campus Administration'
  }
  if (demo) {
    sector = demo.sector
    smartSearches = demo.smartSearches
  }
 
  return {
    id: 'member:' + first.member_id,
    memberId: Number(first.member_id),
    name: first.full_name || email,
    email: email,
    role: role,
    roleLabel: roleLabel,
    cca: first.club_name,
    allowedClubs: ccas,
    isDev: false,
    sector: sector,
    smartSearches: smartSearches,
    positions: positions,
    telegramHandle: first.telegram_handle
  }
}
 
// Returns the persona for a signed-in Supabase user, or null if they have no CCA
async function personaForSignedInEmail(email) {
  const sessionResponse = await supabase.auth.getSession()
  const authSession = sessionResponse.data.session
  if (!authSession) {
    return null
  }
 
  const rows = await fetchMembershipRows(authSession.user.id)
  if (rows.length === 0) {
    return null
  }
  return personaFromRows(rows, email)
}
 
// ---------------- Sign in / sign up ----------------
 
export async function signIn(email, password) {
  const normalized = (email || '').trim().toLowerCase()
  if (!isSmuEmail(normalized)) {
    throw new Error('Restricted: please sign in with your @smu.edu.sg email.')
  }
 
  if (isSupabaseConfigured() && supabase) {
    const response = await supabase.auth.signInWithPassword({ email: normalized, password: password })
    if (response.error) {
      if (response.error.message === 'Invalid login credentials') {
        throw new Error('Incorrect email or password.')
      }
      throw new Error(response.error.message)
    }
 
    let persona = null
    try {
      persona = await personaForSignedInEmail(normalized)
    } catch (error) {
      console.log(error.message)
    }
    if (!persona) {
      await supabase.auth.signOut()
      throw new Error(NOT_EXCO_MESSAGE)
    }
    writeLocalSession(null)
    sessionPersona = persona
    return persona
  }
 
  // Offline fallback (no Supabase keys): demo accounts with the shared demo password only
  const persona = findPersonaByEmail(normalized)
  if (!persona) {
    throw new Error(NOT_EXCO_MESSAGE)
  }
  if (password !== DEMO_PASSWORD) {
    throw new Error('Incorrect email or password.')
  }
  writeLocalSession({ email: normalized })
  sessionPersona = persona
  return persona
}
 
// Sign-up step 1: does this email have a members row with an active CCA, and no login yet?
// OSL adds the club_memberships row; sign-up never gives anyone a CCA or role.
export async function checkSignupEligibility(email) {
  const normalized = (email || '').trim().toLowerCase()
  if (!isSmuEmail(normalized)) {
    throw new Error('Restricted: please use your @smu.edu.sg email.')
  }
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Sign-up needs the Supabase connection, which is not configured on this device.')
  }
 
  const response = await supabase.rpc('rpc_check_signup', { p_email: normalized })
  if (response.error) {
    console.log(response.error.message)
    throw new Error('Could not check the ExCo list right now. Please try again.')
  }
 
  const result = response.data
  if (result.status === 'not_listed') {
    throw new Error("This email isn't on the ExCo list. Ask OSL to add you, or explore as a guest.")
  }
  if (result.status === 'already_registered') {
    throw new Error('This email already has an account. Sign in instead.')
  }
  return { email: normalized, ccas: result.ccas }
}
 
// Sign-up step 2: create the account, then save their own name and Telegram handle.
// The database links the new login to their members row automatically.
// positions is kept so the Sign Up page doesn't change, but titles are set by OSL
// in club_memberships, so it isn't saved.
export async function signUpExco({ email, fullName, positions, telegramHandle, password }) {
  const response = await supabase.auth.signUp({
    email: email,
    password: password,
    options: { data: { full_name: fullName } }
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  if (!response.data.session) {
    // Supabase is still set to email a confirmation link before the account can be used
    throw new Error('Account created, but Supabase is waiting for email confirmation. Turn off "Confirm email" in Supabase Auth settings.')
  }
 
  const profileResponse = await supabase.rpc('rpc_update_my_profile', {
    p_full_name: fullName,
    p_telegram_handle: telegramHandle
  })
  if (profileResponse.error) {
    throw new Error(profileResponse.error.message)
  }
 
  const persona = await personaForSignedInEmail(email)
  if (!persona) {
    throw new Error("Your email isn't on the ExCo list. Ask OSL to add you.")
  }
 
  writeLocalSession(null)
  sessionPersona = persona
  return persona
}
 
export function enterGuest() {
  writeLocalSession({ guest: true })
  sessionPersona = GUEST_PERSONA
  return GUEST_PERSONA
}
 
// Called on page load so a refresh keeps the user signed in
export async function restoreSession() {
  if (isSupabaseConfigured() && supabase) {
    const response = await supabase.auth.getSession()
    const authSession = response.data.session
 
    if (authSession) {
      let persona = null
      try {
        persona = await personaForSignedInEmail(authSession.user.email)
      } catch (error) {
        console.log(error.message)
      }
      if (persona) {
        sessionPersona = persona
        return persona
      }
      // Signed in to Supabase but has no active CCA membership
      await supabase.auth.signOut()
    }
  } else {
    const saved = readLocalSession()
    let persona = null
    if (saved) {
      persona = findPersonaByEmail(saved.email)
    }
    if (persona) {
      sessionPersona = persona
      return persona
    }
  }
 
  const saved = readLocalSession()
  if (saved && saved.guest) {
    sessionPersona = GUEST_PERSONA
    return GUEST_PERSONA
  }
  return null
}
 
// Who is signed in right now (the router's page guard reads this)
export function currentSessionPersona() {
  return sessionPersona
}
 
export async function signOut() {
  if (isSupabaseConfigured() && supabase) {
    await supabase.auth.signOut()
  }
  writeLocalSession(null)
  sessionPersona = null
}
 
// ---------------- Permission checks ----------------
// These decide which team pages open. The facility calendar uses the
// exco_roles flags instead (see sessionState.js), and the database checks again.
 
export function canActForClub(persona, club) {
  if (!persona || !club) {
    return false
  }
  if (persona.isDev) {
    return true
  }
  return persona.role === 'club' && persona.allowedClubs.includes(club)
}
 
export function canApproveTransfers(persona) {
  return !!persona && (persona.role === 'admin' || persona.isDev)
}
 
export function canResetDemo(persona) {
  return !!persona && (persona.role === 'admin' || persona.isDev)
}
 
export function canOpenView(persona, view) {
  if (!persona) {
    return false
  }
  const views = VIEWS_BY_ROLE[persona.role] || []
  return views.includes(view)
}
 
export function homeView(persona) {
  if (persona && persona.role === 'admin') {
    return 'admin'
  }
  return 'facilities'
}
 
// Service-layer guards: check the signed-in user, so hiding a button isn't the only protection
 
export function assertCanActForClub(club) {
  if (!canActForClub(sessionPersona, club)) {
    throw new Error("You don't have permission to act for " + (club || 'this club') + '.')
  }
}
 
export function assertCanApproveTransfers() {
  if (!canApproveTransfers(sessionPersona)) {
    throw new Error('Only OSL administrators can approve or reject transfers.')
  }
}
 
export function assertCanResetDemo() {
  if (!canResetDemo(sessionPersona)) {
    throw new Error('Only OSL administrators can reset the demo data.')
  }
}