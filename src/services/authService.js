// src/services/authService.js
// Login, session persistence and role-based permission checks for SMU Pulse
import { supabase, isSupabaseConfigured } from '../supabase'
import { DEMO_PERSONAS, GUEST_PERSONA, DEMO_PASSWORD } from './authProfiles'

// Used for guest mode, and for the whole session when Supabase isn't configured
const LOCAL_SESSION_KEY = 'pulse_session'
const SMU_EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)*smu\.edu\.sg$/i

// Pages each role may open
const VIEWS_BY_ROLE = {
  admin: ['admin', 'facilities', 'heatmap'],
  club: ['facilities', 'schedule', 'heatmap', 'operations', 'risk'],
  dev: ['facilities', 'schedule', 'heatmap', 'operations', 'risk'],
  guest: ['facilities', 'schedule', 'heatmap', 'operations', 'risk'], // read-only
}

// Who actually signed in (a Dev can view as other personas, but stays Dev here)
let sessionPersona = null

function readLocalSession() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY))
  } catch {
    return null
  }
}

function writeLocalSession(value) {
  try {
    if (value) localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(value))
    else localStorage.removeItem(LOCAL_SESSION_KEY)
  } catch {
    // Storage blocked (e.g. private window): session just won't survive a refresh
  }
}

export function isSmuEmail(email) {
  return SMU_EMAIL_PATTERN.test((email || '').trim())
}

const NOT_EXCO_MESSAGE = 'Pulse sign-in is for CCA ExCos and OSL staff. Explore as a guest to view venues.'

// Demo accounts (already onboarded): their club and role come from authProfiles.js
export function findPersonaByEmail(email) {
  const normalized = (email || '').trim().toLowerCase()
  return Object.values(DEMO_PERSONAS).find((p) => p.email === normalized) || null
}

// Real ExCos: OSL adds one exco_members row per CCA they lead; they fill in the rest at sign-up
function personaFromExcoRows(rows) {
  const ccas = rows.map((r) => r.cca)
  const first = rows[0]
  const positions = Object.fromEntries(rows.map((r) => [r.cca, r.position]))
  const roleLabel = ccas.length > 1
    ? `ExCo (${ccas.join(' & ')})`
    : (first.position ? `${first.cca} ${first.position}` : `${first.cca} ExCo`)
  return {
    id: `exco:${first.email}`,
    name: rows.find((r) => r.full_name)?.full_name || first.email,
    email: first.email,
    role: 'club',
    roleLabel,
    cca: first.cca,
    allowedClubs: ccas,
    isDev: false,
    sector: 'ACF • Arts & Culture',
    smartSearches: ['All Venues', 'Dance Studio', 'Acoustic Room'],
    positions,
    telegramHandle: first.telegram_handle,
  }
}

// Row-level security only lets a signed-in user read their own rows
async function fetchExcoRows(email) {
  const { data, error } = await supabase.from('exco_members').select('*').ilike('email', email).order('cca')
  if (error) throw error
  return data || []
}

async function personaForSignedInEmail(email) {
  const demo = findPersonaByEmail(email)
  if (demo) return demo
  const rows = await fetchExcoRows(email)
  return rows.length ? personaFromExcoRows(rows) : null
}

export async function signIn(email, password) {
  const normalized = (email || '').trim().toLowerCase()
  if (!isSmuEmail(normalized)) {
    throw new Error('Restricted: please sign in with your @smu.edu.sg email.')
  }

  if (isSupabaseConfigured() && supabase) {
    const { error } = await supabase.auth.signInWithPassword({ email: normalized, password })
    if (error) {
      throw new Error(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message)
    }
    const persona = await personaForSignedInEmail(normalized).catch(() => null)
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
  if (!persona) throw new Error(NOT_EXCO_MESSAGE)
  if (password !== DEMO_PASSWORD) throw new Error('Incorrect email or password.')
  writeLocalSession({ email: normalized })
  sessionPersona = persona
  return persona
}

// Sign-up step 1: is this email on OSL's ExCo list, and not signed up yet?
export async function checkSignupEligibility(email) {
  const normalized = (email || '').trim().toLowerCase()
  if (!isSmuEmail(normalized)) {
    throw new Error('Restricted: please use your @smu.edu.sg email.')
  }
  if (findPersonaByEmail(normalized)) {
    throw new Error('This is a demo account that is already set up. Sign in with it instead.')
  }
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Sign-up needs the Supabase connection, which is not configured on this device.')
  }

  const { data, error } = await supabase.rpc('check_exco_signup', { p_email: normalized })
  if (error) throw new Error('Could not check the ExCo list right now. Please try again.')
  if (data?.status === 'not_listed') {
    throw new Error("This email isn't on the ExCo list. Ask OSL to add you, or explore as a guest.")
  }
  if (data?.status === 'already_registered') {
    throw new Error('This email already has an account. Sign in instead.')
  }
  return { email: normalized, ccas: data.ccas }
}

// Sign-up step 2: create the account, then save their profile (never their CCAs, which OSL controls)
// positions: { [cca]: title }, since someone leading 2 CCAs may hold a different title in each
export async function signUpExco({ email, fullName, positions, telegramHandle, password }) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  if (!data.session) {
    // Supabase is still set to email a confirmation link before the account can be used
    throw new Error('Account created, but Supabase is waiting for email confirmation. Turn off "Confirm email" in Supabase Auth settings.')
  }

  const onboardedAt = new Date().toISOString()
  for (const [cca, position] of Object.entries(positions)) {
    const { error: profileError } = await supabase
      .from('exco_members')
      .update({ full_name: fullName, position, telegram_handle: telegramHandle, onboarded_at: onboardedAt })
      .ilike('email', email)
      .eq('cca', cca)
    if (profileError) throw new Error(profileError.message)
  }

  const rows = await fetchExcoRows(email)
  if (!rows.length) throw new Error("Your email isn't on the ExCo list. Ask OSL to add you.")

  writeLocalSession(null)
  sessionPersona = personaFromExcoRows(rows)
  return sessionPersona
}

export function enterGuest() {
  writeLocalSession({ guest: true })
  sessionPersona = GUEST_PERSONA
  return GUEST_PERSONA
}

// Called on page load so a refresh keeps the user signed in
export async function restoreSession() {
  if (isSupabaseConfigured() && supabase) {
    const { data } = await supabase.auth.getSession()
    const email = data.session?.user?.email
    const persona = email ? await personaForSignedInEmail(email).catch(() => null) : null
    if (persona) {
      sessionPersona = persona
      return persona
    }
    // Signed in to Supabase but not on the ExCo list
    if (data.session) await supabase.auth.signOut()
  } else {
    const persona = findPersonaByEmail(readLocalSession()?.email)
    if (persona) {
      sessionPersona = persona
      return persona
    }
  }

  if (readLocalSession()?.guest) {
    sessionPersona = GUEST_PERSONA
    return GUEST_PERSONA
  }
  return null
}

export async function signOut() {
  if (isSupabaseConfigured() && supabase) await supabase.auth.signOut()
  writeLocalSession(null)
  sessionPersona = null
}

// Permission checks (take the persona whose permissions apply)

export function canActForClub(persona, club) {
  if (!persona || !club) return false
  if (persona.isDev) return true
  return persona.role === 'club' && persona.allowedClubs.includes(club)
}

export function canApproveTransfers(persona) {
  return !!persona && (persona.role === 'admin' || persona.isDev)
}

export function canResetDemo(persona) {
  return !!persona && (persona.role === 'admin' || persona.isDev)
}

export function canOpenView(persona, view) {
  return (VIEWS_BY_ROLE[persona?.role] || []).includes(view)
}

export function homeView(persona) {
  return persona?.role === 'admin' ? 'admin' : 'facilities'
}

// Service-layer guards: check the signed-in user, so hiding a button isn't the only protection

export function assertCanActForClub(club) {
  if (!canActForClub(sessionPersona, club)) {
    throw new Error(`You don't have permission to act for ${club || 'this club'}.`)
  }
}

export function assertCanApproveTransfers() {
  if (!canApproveTransfers(sessionPersona)) {
    throw new Error('Only OSL administrators can approve or reject transfers.')
  }
}

export function assertCanResetDemo() {
  if (!canResetDemo(sessionPersona)) {
    throw new Error('Only OSL administrators or Dev can reset the demo data.')
  }
}
