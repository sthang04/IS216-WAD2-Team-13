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

// The ExCo list: only these emails can sign in, and the role comes from here, never from the user
export function findPersonaByEmail(email) {
  const normalized = (email || '').trim().toLowerCase()
  return Object.values(DEMO_PERSONAS).find((p) => p.email === normalized) || null
}

export async function signIn(email, password) {
  const normalized = (email || '').trim().toLowerCase()
  if (!isSmuEmail(normalized)) {
    throw new Error('Restricted: please sign in with your @smu.edu.sg email.')
  }
  const persona = findPersonaByEmail(normalized)
  if (!persona) {
    throw new Error('Pulse sign-in is for CCA ExCos and OSL staff. Explore as a guest to view venues.')
  }

  if (isSupabaseConfigured() && supabase) {
    const { error } = await supabase.auth.signInWithPassword({ email: normalized, password })
    if (error) {
      throw new Error(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message)
    }
    writeLocalSession(null)
  } else {
    // Offline fallback (no Supabase keys): accept the shared demo password only
    if (password !== DEMO_PASSWORD) throw new Error('Incorrect email or password.')
    writeLocalSession({ email: normalized })
  }

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
    const { data } = await supabase.auth.getSession()
    const persona = findPersonaByEmail(data.session?.user?.email)
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
