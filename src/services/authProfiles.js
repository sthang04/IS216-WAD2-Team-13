// src/services/authProfiles.js
// Institutional User Profiles & CCA Scoping Definition for SMU Pulse

export const ALL_CLUBS = [
  'Ardiente',
  'Artdicted',
  'Ballare',
  'Broadcast & Entertainment',
  'Caderas Latinas',
  'Chamber Choir',
  'Chinese Orchestra',
  'Eurhythmix',
  'Funk Movement',
  'Guitarissimo',
  'INDANCITY',
  'Ivory Keys',
  'Literati',
  'Malay Language & Cultural Club',
  'SMUSAIC',
  'Samba Masala',
  'SoundFoundry',
  'Stageit',
  'Stereometa',
  'Symphonia',
  'VOIX',
  'SMU Red Cross',
  'Rotaract Club',
  'ACF ExCo',
];

export const DEMO_PERSONAS = {
  rachel: {
    id: 'rachel',
    name: 'Rachel Tan',
    email: 'rachel.tan.2024@scis.smu.edu.sg',
    role: 'club',
    roleLabel: 'Eurhythmix ExCo',
    cca: 'Eurhythmix',
    allowedClubs: ['Eurhythmix'],
    isDev: false,
    sector: 'ACF • Arts & Culture',
    smartSearches: ['Studio L7.2', 'Dance Studio', 'Sprung Floor', 'Connexion', 'Evening Slots'],
  },
  darren: {
    id: 'darren',
    name: 'Darren Koh',
    email: 'darren.koh.2024@business.smu.edu.sg',
    role: 'club',
    roleLabel: 'Samba Masala ExCo',
    cca: 'Samba Masala',
    allowedClubs: ['Samba Masala'],
    isDev: false,
    sector: 'ACF • Arts & Culture',
    smartSearches: ['Percussion Hall', 'Acoustic Room', 'SOA Basement', 'Weekend Rehearsal'],
  },
  marcus: {
    id: 'marcus',
    name: 'Marcus Lim',
    email: 'marcus.lim.2024@socsc.smu.edu.sg',
    role: 'club',
    roleLabel: 'SMU Symphonia ExCo',
    cca: 'Symphonia',
    allowedClubs: ['Symphonia'],
    isDev: false,
    sector: 'ACF • Arts & Culture',
    smartSearches: ['SMU Hall', 'Acoustic Room', 'Instrument Storage', 'Connexion'],
  },
  chloe: {
    id: 'chloe',
    name: 'Chloe Ang',
    email: 'chloe.ang@smu.edu.sg',
    role: 'admin',
    roleLabel: 'OSL Facility Administrator',
    cca: 'Office of Student Life',
    allowedClubs: ['ACF ExCo', 'Office of Student Life'],
    isDev: false,
    sector: 'Campus Administration',
    smartSearches: ['Pending Admin Sign-off', 'Proposed Peer Transfer', 'Studio L7.2', 'Connexion'],
  },
  dev: {
    id: 'dev',
    name: 'Dev Administrator',
    email: 'dev.admin@smu.edu.sg',
    role: 'dev',
    roleLabel: 'Developer / Super Admin',
    cca: 'Eurhythmix',
    allowedClubs: ALL_CLUBS,
    isDev: true,
    sector: 'System Administration',
    smartSearches: ['All Venues', 'Studio L7.2', 'Pending Admin Sign-off', 'Waitlist > 1', 'Dance Studio'],
  },
  john: {
    id: 'john',
    name: 'John Doe',
    email: 'john.doe.2025@scis.smu.edu.sg',
    role: 'club',
    roleLabel: 'General Student Member',
    cca: 'Eurhythmix',
    allowedClubs: ['Eurhythmix'],
    isDev: false,
    sector: 'Student Body',
    smartSearches: ['Dance Studio', 'SCIS Sound Studio', 'All Venues'],
  },
};

export function getPersonaByEmail(email) {
  const normalized = email.trim().toLowerCase();
  if (normalized.includes('darren') || normalized.includes('samba')) return DEMO_PERSONAS.darren;
  if (normalized.includes('marcus') || normalized.includes('symphonia')) return DEMO_PERSONAS.marcus;
  if (normalized.includes('chloe') || normalized.includes('osl') || normalized.includes('admin@smu')) return DEMO_PERSONAS.chloe;
  if (normalized.includes('dev') || normalized.includes('super')) return DEMO_PERSONAS.dev;
  if (normalized.includes('john') || normalized.includes('doe')) return DEMO_PERSONAS.john;
  return DEMO_PERSONAS.rachel;
}
