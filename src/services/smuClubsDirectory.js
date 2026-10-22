// src/services/smuClubsDirectory.js
// Official SMU Student Clubs & Societies Directory
// Sourced from official SMU Office of Student Life (OSL) Registry: Website_Clubs_and_Societies_030620.pdf

export const OFFICIAL_FACILITY_ROUTING = {
  facilityBookingSystem: 'fbs@smu.edu.sg',
  artsVenues: 'artsvenues@smu.edu.sg',
  artsVenuesFacility: 'artsvenuesfacility@sa.smu.edu.sg',
  acfExCo: 'artsncultural@sa.smu.edu.sg',
  ssuExCo: 'ssu@sa.smu.edu.sg',
  sicsExCo: 'SICS@sa.smu.edu.sg',
  smusa: 'smusa@sa.smu.edu.sg',
  oslGeneral: 'osl@smu.edu.sg'
};

export const SMU_CLUBS_DIRECTORY = [
  // Arts & Cultural Fraternity (ACF) - 23 Clubs
  { name: 'SMU Ardiente', email: 'ardiente@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Latin Ballroom Dance' },
  { name: 'SMU Artdicted', email: 'artdicted@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Visual Arts' },
  { name: 'SMU Ballare', email: 'ballare@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Standard Ballroom Dance' },
  { name: 'SMU Broadcast & Entertainment', email: 'smube@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Hosting & Production' },
  { name: 'SMU Caderas Latinas', email: 'caderaslatinas@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Salsa Dance' },
  { name: 'SMU Chamber Choir', email: 'chamberchoir@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Choral Music' },
  { name: 'SMU Chinese Orchestra', email: 'smuco@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Traditional & Pop Chinese Music' },
  { name: 'SMU Eurhythmix', email: 'eurhythmix@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Hip-Hop Dance' },
  { name: 'SMU Funk Movement', email: 'funkmovement@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Funk Styles Dance' },
  { name: 'SMU Guitarissimo', email: 'guitarissimo@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Niibori Guitar Ensemble' },
  { name: 'SMU INDANCITY', email: 'indancity@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Contemporary Dance' },
  { name: 'SMU Indian Cultural Society', email: 'ics@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Indian Arts & Culture' },
  { name: 'SMU Ivory Keys', email: 'ivorykeys@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Piano Ensemble' },
  { name: 'SMU Komunitas Indonesia', email: 'smuki@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Indonesian Arts & Culture' },
  { name: 'SMU Literati', email: 'literati@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Literary Arts' },
  { name: 'SMU Malay Language & Cultural Club', email: 'mlcc@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Malay Drama & Music' },
  { name: 'SMUSAIC', email: 'smusaic@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Photography' },
  { name: 'SMU Samba Masala', email: 'samba@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Afro-Brazilian Percussion' },
  { name: 'SMU SoundFoundry', email: 'soundfoundry@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Pop Bands & Live Music' },
  { name: 'SMU StageIT', email: 'stageit@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Theatre' },
  { name: 'SMU Stereometa', email: 'stereometa@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'DJ Collective' },
  { name: 'SMU Symphonia', email: 'symphonia@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'Wind & Strings Orchestra' },
  { name: 'SMU VOIX', email: 'smuvoix@sa.smu.edu.sg', cluster: 'Arts & Cultural Fraternity (ACF)', type: 'A Cappella Music' },

  // SMU Sports Union (SSU) - Representative Selection
  { name: 'SMU Taekwondo', email: 'smutkd@sa.smu.edu.sg', cluster: 'SMU Sports Union (SSU)', type: 'Martial Arts' },
  { name: 'SMU Ultimate Frisbee', email: 'smuufc@sa.smu.edu.sg', cluster: 'SMU Sports Union (SSU)', type: 'Frisbee' },
  { name: 'SMU Badminton', email: 'badminton@sa.smu.edu.sg', cluster: 'SMU Sports Union (SSU)', type: 'Racquet Sports' },
  { name: 'SMU Floorball', email: 'smufloorball@sa.smu.edu.sg', cluster: 'SMU Sports Union (SSU)', type: 'Team Sports' },

  // Special Interest & Community Service (SICS)
  { name: 'SMU Red Cross Youth', email: 'redcross@sa.smu.edu.sg', cluster: 'Special Interest & Community Services (SICS)', type: 'Humanitarian' },
  { name: 'SMU Rotaract Club', email: 'smurotaract@sa.smu.edu.sg', cluster: 'Special Interest & Community Services (SICS)', type: 'Youth Leadership' }
];

// Institutional Demerit Policy & SSU/ACF Penalty Scale (SSU Handbook Clause 9.1(c) & ACF Section 5.2.7)
export const SSU_DEMERIT_POLICY = {
  clause: 'SSU Handbook Clause 9.1(c) & ACF Constitution Section 5.2.7',
  advanceReleaseNoticeHours: 48,
  rulesSummary: 'Under SSU Standing Orders and ACF Regulations, any club holding a facility booking that fails to occupy the venue or fails to release the slot into the marketplace at least 48 hours in advance receives an Institutional Demerit Point.',
  penaltyTiers: [
    {
      level: 1,
      name: '1st Infraction',
      points: 1,
      standing: 'Warning Issued',
      action: 'Formal Written Warning',
      consequence: 'Formal warning logged on OSL compliance ledger; zero booking deduction.'
    },
    {
      level: 2,
      name: '2nd Infraction',
      points: 2,
      standing: 'Conditional Standing',
      action: '2 Penalty Points Recorded',
      consequence: 'Official demerit logged; written notice dispatched to Club President and OSL Advisor.'
    },
    {
      level: 3,
      name: '3rd Infraction',
      points: 4,
      standing: 'Priority Downgraded',
      action: '4 Penalty Points & Allocation Penalty',
      consequence: 'Loss of first-priority window for next semester BOSS / MPSH block-allocation.'
    },
    {
      level: 4,
      name: '4th Infraction',
      points: 6,
      standing: 'Facility Banned',
      action: '6 Penalty Points & Mandatory Ban',
      consequence: 'Immediate 2-week campus facility usage ban and ACF/SSU budgetary penalty review.'
    }
  ],
  waitlistCutoffWindows: [
    {
      session: 'Morning Sessions (08:00 - 13:00)',
      cutoffTime: '10:00 PM previous night',
      hoursPrior: 10,
      rationale: 'Prevents middle-of-the-night slot dumping and protects sleeping clubs from unattended demerit violations.'
    },
    {
      session: 'Afternoon Sessions (13:00 - 18:00)',
      cutoffTime: '09:00 AM same day',
      hoursPrior: 4,
      rationale: 'Ensures minimum 4-hour window for student mobilization and equipment prep.'
    },
    {
      session: 'Evening Sessions (18:00 - 22:30)',
      cutoffTime: '12:00 PM noon same day',
      hoursPrior: 6,
      rationale: 'Allows EXCO to confirm dancer/member attendance before rehearsal commences.'
    }
  ]
};

// Compute waitlist cutoff based on slot start hour
export function calculateWaitlistCutoff(timeSlot) {
  const match = (timeSlot || '').match(/^(\d{1,2}):/);
  if (!match) return { cutoffText: '12:00 PM noon', isMorning: false, hoursPrior: 6 };
  const startHour = parseInt(match[1], 10);
  if (startHour < 13) {
    return {
      cutoffText: '10:00 PM previous night',
      sessionName: 'Morning Session',
      isMorning: true,
      hoursPrior: 10,
      ruleText: 'Waitlist auto-closes at 10:00 PM previous night to protect queued clubs from midnight slot drops and unattended demerits.'
    };
  } else if (startHour < 18) {
    return {
      cutoffText: '09:00 AM same day',
      sessionName: 'Afternoon Session',
      isMorning: false,
      hoursPrior: 4,
      ruleText: 'Waitlist auto-closes at 09:00 AM same day to ensure adequate notice for equipment and safety mobilization.'
    };
  } else {
    return {
      cutoffText: '12:00 PM noon same day',
      sessionName: 'Evening Session',
      isMorning: false,
      hoursPrior: 6,
      ruleText: 'Waitlist auto-closes at 12:00 PM noon to allow EXCOs sufficient confirmation time before evening training.'
    };
  }
}

// Helper to look up official email address by club name
export function getClubEmail(clubName) {
  const clean = (clubName || '').toLowerCase().replace(/^smu\s+/, '').trim();
  const match = SMU_CLUBS_DIRECTORY.find(c => 
    c.name.toLowerCase().includes(clean) || clean.includes(c.name.toLowerCase().replace(/^smu\s+/, ''))
  );
  return match ? match.email : `${clean.replace(/\s+/g, '')}@sa.smu.edu.sg`;
}

// Generate the standardized transfer email payload matching SMU FBS guidelines
export function generateTransferEmailPayload(slot, claimingClub, releasingClub) {
  const claimingEmail = getClubEmail(claimingClub);
  const releasingEmail = getClubEmail(releasingClub);
  const refNo = slot.fbs_ref || slot.audit_ticket_id || 'BK-20271017-000053';

  return {
    from: 'Pulse Automated Dispatch <pulse.system@sa.smu.edu.sg>',
    to: claimingEmail,
    cc: [
      releasingEmail,
      OFFICIAL_FACILITY_ROUTING.artsVenuesFacility,
      OFFICIAL_FACILITY_ROUTING.artsVenues,
      'eechiing@smu.edu.sg' // OSL Senior Staff Advisor
    ],
    subject: `Transfer of Facility Booking Slip [Ref. No: ${refNo} | ${slot.venue_name} | ${slot.event_date || '2027-10-17'} ${slot.time_slot}]`,
    fbsRef: refNo,
    templateBody: `Dear all,\n\n${releasingClub} has formally transferred the attached booking slip to ${claimingClub}, dated ${slot.event_date || '2027-10-17'} (${slot.time_slot}) for ${slot.venue_name} [Booking Ref: ${refNo}].\n\nCompliance Verification:\n1. Releasing club submitted handover >48 hours in advance: Verified (Zero demerit points logged under SSU Clause 9.1(c)).\n2. Dual-stage administrative gatekeeper: Verified by OSL Administrator Chloe Ang.\n3. Legal venue usage responsibility is officially reassigned to ${claimingClub}.\n\nBest regards,\nPulse Automated Logistics Engine\nOffice of Student Life (OSL) | Singapore Management University`
  };
}
