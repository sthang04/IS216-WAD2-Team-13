
// Login, session persistence and role-based permission checks for SMU Pulse
//
// Where a signed-in person's details come from (Supabase):
//   auth.users -> members (auth_user_id) -> club_memberships -> exco_roles
// The view v_user_club_memberships joins these: one row per CCA membership.
// The old exco_members table is no longer read here. Sign-up functions:
// supabase/migrations/20261103000100_pulse_signup_self_roles.sql
 
import { supabase, isSupabaseConfigured } from '../supabase'
import { DEMO_PERSONAS, GUEST_PERSONA, DEMO_PASSWORD } from './authProfiles'
import { resolveClubId, resolveClubName } from './sessionState'
 
// Used for guest mode, and for the whole session when Supabase isn't configured
const LOCAL_SESSION_KEY = 'pulse_session'
const SMU_EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)*smu\.edu\.sg$/i
 
const NOT_EXCO_MESSAGE = 'Pulse sign-in is for CCA ExCos and OSL staff. Explore as a guest to view venues.'
 
// Pages each role may open
const VIEWS_BY_ROLE = {
  admin: ['facilities'], // OSL: the facility calendar and its OSL Review tab
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
  // Deduplicate and canonicalize club names so "Eurhythmix" and "SMU Eurhythmix" never duplicate
  const ccas = []
  const seenIds = new Set()
  const positions = {}
  rows.forEach((row) => {
    const rawName = row.club_name || ''
    const cid = resolveClubId(rawName)
    const canonicalName = cid ? (resolveClubName(cid) || rawName) : rawName
    if (cid && !seenIds.has(cid)) {
      seenIds.add(cid)
      ccas.push(canonicalName)
    } else if (!cid && !ccas.includes(canonicalName)) {
      ccas.push(canonicalName)
    }
    positions[canonicalName] = row.role_name
  })
 
  // Label shown under the name, e.g. 'Eurhythmix Logistics Director'
  let roleLabel = ''
  if (isAdmin) {
    roleLabel = 'OSL Facility Administrator'
  } else if (ccas.length > 1) {
    roleLabel = 'ExCo (' + ccas.join(' & ') + ')'
  } else {
    roleLabel = (ccas[0] || first.club_name) + ' ' + first.role_name
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
    if (demo.roleLabel) {
      roleLabel = demo.roleLabel
    }
    if (demo.cca) {
      const demoCid = resolveClubId(demo.cca)
      const canonicalDemoCca = demoCid ? (resolveClubName(demoCid) || demo.cca) : demo.cca
      if (demoCid && !seenIds.has(demoCid)) {
        seenIds.add(demoCid)
        ccas.unshift(canonicalDemoCca)
      } else if (!demoCid && !ccas.includes(canonicalDemoCca)) {
        ccas.unshift(canonicalDemoCca)
      }
    }
  }

  const primaryCca = (demo && demo.cca)
    ? (resolveClubId(demo.cca) ? resolveClubName(resolveClubId(demo.cca)) || demo.cca : demo.cca)
    : (ccas[0] || first.club_name)
  const finalClubs = ccas.length > 0 ? ccas : (demo ? demo.allowedClubs : [primaryCca])

  return {
    id: 'member:' + first.member_id,
    memberId: Number(first.member_id),
    name: (demo && demo.name) ? demo.name : (first.full_name || email),
    email: email,
    role: (demo && demo.role) ? demo.role : role,
    roleLabel: roleLabel,
    cca: primaryCca,
    allowedClubs: (demo && demo.allowedClubs && demo.isDev) ? demo.allowedClubs : finalClubs,
    isDev: (demo && demo.isDev) || false,
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

  const demoPersona = findPersonaByEmail(normalized)

  if (isSupabaseConfigured() && supabase) {
    const response = await supabase.auth.signInWithPassword({ email: normalized, password: password })
    if (response.error) {
      // If Supabase authentication returned an error (e.g. demo account not yet in Supabase auth),
      // check if this is an official demo persona with the shared demo password
      if (demoPersona && password === DEMO_PASSWORD) {
        console.warn(`[auth] Supabase auth returned ${response.error.message}; activating demo persona fallback for ${normalized}`)
        writeLocalSession({ email: normalized })
        sessionPersona = demoPersona
        return demoPersona
      }
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

    // If signed into Supabase Auth but has no active CCA membership row in DB
    // (e.g. Dev Admin whose credentials exist in auth.users but has no row in v_user_club_memberships),
    // fall back cleanly to the built-in demo persona
    if (!persona && demoPersona) {
      console.warn(`[auth] Supabase user has no database membership rows; falling back to demo persona for ${normalized}`)
      writeLocalSession({ email: normalized })
      sessionPersona = demoPersona
      return demoPersona
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
// OSL adds the club_memberships row (role EXCO_MEMBER); roles = what the person may pick next.
export async function checkSignupEligibility(email) {
  const normalized = (email || '').trim().toLowerCase()
  if (!isSmuEmail(normalized)) {
    throw new Error('Restricted: please use your @smu.edu.sg email.')
  }

  // Demo onboarding placeholder emails (Self-resetting demo accounts for filming & prof evaluation)
  const DEMO_ONBOARDING_EMAILS = [
    'new.exco@scis.smu.edu.sg',
    'new.exco.2025@scis.smu.edu.sg',
    'demo.onboarding@scis.smu.edu.sg',
    'onboarding.demo@scis.smu.edu.sg'
  ]
  if (DEMO_ONBOARDING_EMAILS.includes(normalized)) {
    return {
      email: normalized,
      fullName: 'New ExCo Member',
      ccas: ['SMU Eurhythmix'],
      roles: [
        { code: 'LOGISTICS_DIRECTOR', name: 'Logistics Director' },
        { code: 'PRESIDENT', name: 'President' },
        { code: 'VICE_PRESIDENT', name: 'Vice President' },
        { code: 'HONORARY_GEN_SEC', name: 'Honorary General Secretary' },
        { code: 'FINANCE_DIRECTOR', name: 'Finance Director' },
        { code: 'MARKETING_DIRECTOR', name: 'Marketing Director' }
      ]
    }
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
  return { email: normalized, fullName: result.full_name || '', ccas: result.ccas, roles: result.roles || [] }
}

// Sign-up step 2: create the account, then save their own name, Telegram handle and role.
// The database links the new login to their members row automatically.
// positions = { [cca]: role_code }; the database only accepts it while the role is still EXCO_MEMBER.
export async function signUpExco({ email, fullName, positions, telegramHandle, password }) {
  const normalized = (email || '').trim().toLowerCase()

  // Demo onboarding placeholder emails (Self-resetting demo accounts for filming & prof evaluation)
  const DEMO_ONBOARDING_EMAILS = [
    'new.exco@scis.smu.edu.sg',
    'new.exco.2025@scis.smu.edu.sg',
    'demo.onboarding@scis.smu.edu.sg',
    'onboarding.demo@scis.smu.edu.sg'
  ]
  if (DEMO_ONBOARDING_EMAILS.includes(normalized)) {
    const roleCode = positions['SMU Eurhythmix'] || 'LOGISTICS_DIRECTOR'
    const roleLabels = {
      'LOGISTICS_DIRECTOR': 'Eurhythmix Logistics Director',
      'PRESIDENT': 'Eurhythmix President',
      'VICE_PRESIDENT': 'Eurhythmix Vice President',
      'HONORARY_GEN_SEC': 'Eurhythmix Hon Gen Sec',
      'FINANCE_DIRECTOR': 'Eurhythmix Finance Director',
      'MARKETING_DIRECTOR': 'Eurhythmix Marketing Director'
    }
    const persona = {
      id: 'new-exco-demo',
      name: fullName || 'New ExCo Member',
      email: normalized,
      role: 'club',
      roleLabel: roleLabels[roleCode] || 'Eurhythmix ExCo Member',
      cca: 'SMU Eurhythmix',
      allowedClubs: ['SMU Eurhythmix'],
      isDev: false,
      sector: 'ACF • Arts & Culture',
      smartSearches: ['Studio L7.2', 'Dance Studio', 'Sprung Floor', 'Connexion', 'Evening Slots']
    }
    writeLocalSession({
      email: normalized,
      name: fullName,
      cca: 'SMU Eurhythmix',
      roleLabel: roleLabels[roleCode] || 'Eurhythmix ExCo Member'
    })
    sessionPersona = persona
    return persona
  }

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

  const rolesResponse = await supabase.rpc('rpc_set_my_roles', { p_roles: positions })
  if (rolesResponse.error) {
    throw new Error(rolesResponse.error.message)
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
      // Signed in to Supabase but has no active CCA membership in database
      const demo = findPersonaByEmail(authSession.user.email)
      if (demo) {
        sessionPersona = demo
        return demo
      }
      await supabase.auth.signOut()
    }
  }

  const saved = readLocalSession()
  let persona = null
  if (saved && saved.email) {
    persona = findPersonaByEmail(saved.email)
    if (!persona && saved.cca) {
      persona = {
        id: 'new-exco-demo',
        name: saved.name || 'New ExCo Member',
        email: saved.email,
        role: 'club',
        roleLabel: saved.roleLabel || `${saved.cca} ExCo Member`,
        cca: saved.cca,
        allowedClubs: [saved.cca],
        isDev: false,
        sector: 'ACF • Arts & Culture',
        smartSearches: ['Studio L7.2', 'Dance Studio', 'Sprung Floor', 'Connexion', 'Evening Slots']
      }
    }
  }
  if (persona) {
    sessionPersona = persona
    return persona
  }

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