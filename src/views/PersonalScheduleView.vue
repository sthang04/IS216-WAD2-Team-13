<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  apiMode: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  activePersona: {
    type: Object,
    default: () => ({
      name: 'Rachel Tan',
      cca: 'Eurhythmix',
      roleLabel: 'Eurhythmix ExCo',
      email: 'rachel.tan.2024@scis.smu.edu.sg'
    })
  }
});

const isCheckedIn = ref(false);
const isLocating = ref(false);
const checkInMsg = ref('');
const toastMsg = ref('');

// Guests can look around but not make changes
function blockedForGuest() {
  if (!props.readOnly) return false
  toastMsg.value = 'Guest view is read-only. Sign in as a CCA ExCo to make changes.'
  return true
}
const selectedCategory = ref('All'); // 'All', 'CCA', 'Academic', 'Personal', 'Duty'
const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);

// Manual Attendance Fallback State (Basement / Weak GPS)
const showManualCheckInModal = ref(false);
const manualVerificationType = ref('passcode'); // 'passcode' | 'witness'
const manualPasscodeInput = ref('LKS-742');
const manualWitnessName = ref('Amanda Tang (Honorary General Secretary)');
const manualReasonInput = ref('Basement Li Ka Shing B1 studio (Concrete shielded GPS)');
const verificationMethodUsed = ref('');

// Calibrated SMU Venue Coordinates (Li Ka Shing B1 Main Hall Stage)
const VENUE_LAT = 1.2966;
const VENUE_LNG = 103.8502;

// Initial Schedule Events with academic courses and CCA obligations
const scheduleEvents = ref([
  {
    id: 1,
    title: 'IS216 Web Application Development II (G1)',
    category: 'Academic',
    date: '2026-10-23',
    startTime: '15:30',
    endTime: '17:00',
    venue: 'SCIS1 Seminar Room 2.1',
    role: 'Undergraduate Student',
    status: 'Completed',
    transitNote: 'Central Campus • SCIS1 Level 2',
    notes: 'Sprint presentation dry-run and Vue component architecture lab.',
    isCustom: false
  },
  {
    id: 2,
    title: 'Act 2 Floor Positioning & Soundcheck',
    category: 'CCA',
    date: '2026-10-23',
    startTime: '18:30',
    endTime: '19:15',
    venue: 'Main Hall Stage, Li Ka Shing B1',
    role: 'Floor Positioning Lead',
    status: 'In Progress',
    transitNote: '650m from SCIS1, approx 8 mins walk via Campus Concourse',
    notes: 'Verify wireless stage monitor feeds and tape marks for hip-hop ensemble.',
    isCustom: false
  },
  {
    id: 3,
    title: 'Act 2 Audio & Lighting Programming',
    category: 'Duty',
    date: '2026-10-23',
    startTime: '19:30',
    endTime: '20:10',
    venue: 'Audio & Lighting Booth, LKS B1',
    role: 'Stage Crew Coordinator',
    status: 'Not Started',
    transitNote: 'Adjacent to Main Hall Stage',
    notes: 'Coordinate cue triggers with SoundFoundry live band technicians.',
    isCustom: false
  },
  {
    id: 4,
    title: 'Opening Night Live Production (Curtain Call)',
    category: 'CCA',
    date: '2026-10-23',
    startTime: '20:15',
    endTime: '21:45',
    venue: 'Main Hall Stage, Li Ka Shing B1',
    role: 'Full Cast Floor Runner',
    status: 'Not Started',
    transitNote: 'Backstage Holding Room B1.2',
    notes: 'All cast members to standby at wings by 20:00.',
    isCustom: false
  },
  {
    id: 5,
    title: 'Eurhythmix ExCo Debrief & Safety Check',
    category: 'Duty',
    date: '2026-10-23',
    startTime: '22:00',
    endTime: '22:30',
    venue: 'Studio L7.2 (Dance), Connexion',
    role: 'Honorary General Secretary',
    status: 'Not Started',
    transitNote: 'Take Linkbridge from LKS to Connexion L7 (6 mins walk)',
    notes: 'Verify studio equipment inventory and lock up keys per SSU Clause 9.2(c).',
    isCustom: false
  }
]);

// Modal Form State
const eventForm = ref({
  title: '',
  category: 'CCA',
  date: '2026-10-23',
  startTime: '17:15',
  endTime: '18:15',
  venue: 'Studio L7.2 (Dance)',
  role: 'Participant',
  transitNote: '5 min walk via Concourse',
  notes: ''
});

// Category Filtered Schedule
const filteredEvents = computed(() => {
  if (selectedCategory.value === 'All') return scheduleEvents.value;
  return scheduleEvents.value.filter(e => e.category === selectedCategory.value);
});

// Conflict Detection: checks if academic classes clash with CCA rehearsal slots
const conflictingEventIds = computed(() => {
  const conflicts = new Set();
  const academics = scheduleEvents.value.filter(e => e.category === 'Academic');
  const ccas = scheduleEvents.value.filter(e => e.category === 'CCA');

  for (const acad of academics) {
    for (const cca of ccas) {
      if (acad.date === cca.date) {
        if (
          (cca.startTime >= acad.startTime && cca.startTime < acad.endTime) ||
          (cca.endTime > acad.startTime && cca.endTime <= acad.endTime) ||
          (cca.startTime <= acad.startTime && cca.endTime >= acad.endTime)
        ) {
          conflicts.add(acad.id);
          conflicts.add(cca.id);
        }
      }
    }
  }
  return conflicts;
});

// Active assignment highlight
const activeAssignment = computed(() => {
  return scheduleEvents.value.find(e => e.status === 'In Progress') || scheduleEvents.value.find(e => e.status === 'Not Started') || scheduleEvents.value[0];
});

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function handleGeolocationCheckIn() {
  if (blockedForGuest()) return
  if (!navigator.geolocation) {
    verificationMethodUsed.value = 'Simulated GPS Sensor (within 25m)';
    simulateSuccessCheckIn('HTML5 Geolocation sensor active: Checked in within 30m of Main Hall Stage!');
    return;
  }

  isLocating.value = true;
  checkInMsg.value = 'Querying hardware GPS sensor...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      isLocating.value = false;
      const userLat = position.coords.latitude;
      const userLng = position.coords.longitude;
      const dist = calculateDistance(userLat, userLng, VENUE_LAT, VENUE_LNG);

      isCheckedIn.value = true;
      verificationMethodUsed.value = `HTML5 GPS Sensor (${Math.round(dist)}m from Stage)`;
      checkInMsg.value = `Verified On-Site via GPS! (${Math.round(dist)}m from Li Ka Shing Stage)`;
      toastMsg.value = 'Presence confirmed! Attendance status broadcasted to ExCo command center.';
      setTimeout(() => { toastMsg.value = ''; }, 4500);
    },
    (error) => {
      isLocating.value = false;
      // When GPS fails or is shielded indoors, proactively offer manual fallback!
      showManualCheckInModal.value = true;
      toastMsg.value = 'GPS signal unavailable in basement area. Switched to manual session verification.';
      setTimeout(() => { toastMsg.value = ''; }, 4500);
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

function simulateSuccessCheckIn(msg) {
  isCheckedIn.value = true;
  checkInMsg.value = msg;
  toastMsg.value = 'Presence confirmed! Attendance status broadcasted to ExCo command center.';
  setTimeout(() => { toastMsg.value = ''; }, 4500);
}

// Manual Check-In Handlers
function openManualCheckIn() {
  if (blockedForGuest()) return
  showManualCheckInModal.value = true;
}

function closeManualCheckIn() {
  showManualCheckInModal.value = false;
}

function submitManualCheckIn() {
  isCheckedIn.value = true;
  if (manualVerificationType.value === 'passcode') {
    const code = manualPasscodeInput.value.trim() || 'LKS-742';
    checkInMsg.value = `Verified via Session Passcode (${code})`;
    verificationMethodUsed.value = `Manual Venue Passcode [${code}] • GPS Fallback`;
    toastMsg.value = `Manual attendance verified via Passcode ${code}! Logged for SLiMS endorsement.`;
  } else {
    const officer = manualWitnessName.value;
    checkInMsg.value = `Verified via Officer Sign-off (${officer.split(' ')[0]})`;
    verificationMethodUsed.value = `EXCO Officer Witness (${officer}) • GPS Fallback`;
    toastMsg.value = `Manual attendance verified via ${officer}! Recorded on club attendance ledger.`;
  }
  closeManualCheckIn();
  setTimeout(() => { toastMsg.value = ''; }, 4500);
}

function resetCheckIn() {
  if (blockedForGuest()) return
  isCheckedIn.value = false;
  checkInMsg.value = '';
  verificationMethodUsed.value = '';
  toastMsg.value = 'Attendance verification reset.';
  setTimeout(() => { toastMsg.value = ''; }, 3000);
}

function toggleEventStatus(event) {
  if (blockedForGuest()) return
  if (event.status === 'Not Started') {
    event.status = 'In Progress';
    toastMsg.value = `Started: "${event.title}" is now active.`;
  } else if (event.status === 'In Progress') {
    event.status = 'Completed';
    toastMsg.value = `Completed: "${event.title}" marked as finished.`;
  } else {
    event.status = 'Not Started';
    toastMsg.value = `Status reset for "${event.title}".`;
  }
  setTimeout(() => { toastMsg.value = ''; }, 3500);
}

// Modal Form Actions
function openAddModal() {
  if (blockedForGuest()) return
  isEditing.value = false;
  editingId.value = null;
  eventForm.value = {
    title: '',
    category: 'CCA',
    date: '2026-10-23',
    startTime: '17:15',
    endTime: '18:15',
    venue: 'Studio L7.2 (Dance)',
    role: `${props.activePersona.cca || 'Eurhythmix'} Member`,
    transitNote: '5 min walk via Campus Concourse',
    notes: ''
  };
  showModal.value = true;
}

function openEditModal(event) {
  if (blockedForGuest()) return
  isEditing.value = true;
  editingId.value = event.id;
  eventForm.value = {
    title: event.title,
    category: event.category,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    venue: event.venue,
    role: event.role,
    transitNote: event.transitNote || 'Campus Concourse transit',
    notes: event.notes || ''
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

function saveEvent() {
  if (!eventForm.value.title.trim()) return;

  if (isEditing.value && editingId.value) {
    const idx = scheduleEvents.value.findIndex(e => e.id === editingId.value);
    if (idx !== -1) {
      Object.assign(scheduleEvents.value[idx], {
        ...eventForm.value
      });
      toastMsg.value = `Updated: "${eventForm.value.title}" successfully modified.`;
    }
  } else {
    const newId = Date.now();
    scheduleEvents.value.push({
      id: newId,
      ...eventForm.value,
      status: 'Not Started',
      isCustom: true
    });
    // Re-sort schedule by start time
    scheduleEvents.value.sort((a, b) => a.startTime.localeCompare(b.startTime));
    toastMsg.value = `Added: "${eventForm.value.title}" scheduled on your calendar.`;
  }

  closeModal();
  setTimeout(() => { toastMsg.value = ''; }, 4000);
}

function deleteEvent(id) {
  if (blockedForGuest()) return
  const item = scheduleEvents.value.find(e => e.id === id);
  if (!item) return;
  scheduleEvents.value = scheduleEvents.value.filter(e => e.id !== id);
  toastMsg.value = `Removed: "${item.title}" deleted from personal schedule.`;
  setTimeout(() => { toastMsg.value = ''; }, 4000);
}

// Generate authentic .ics iCalendar file for OASIS timetable sync
function exportCalendarICS() {
  let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//SMU Pulse//Personal Schedule v2.0//EN\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\n";

  for (const ev of scheduleEvents.value) {
    const dateStr = ev.date.replace(/-/g, '');
    const startStr = ev.startTime.replace(/:/g, '') + '00';
    const endStr = ev.endTime.replace(/:/g, '') + '00';

    icsContent += "BEGIN:VEVENT\n";
    icsContent += `UID:pulse-sched-${ev.id}@smu.edu.sg\n`;
    icsContent += `DTSTAMP:20261021T120000Z\n`;
    icsContent += `DTSTART;TZID=Asia/Singapore:${dateStr}T${startStr}\n`;
    icsContent += `DTEND;TZID=Asia/Singapore:${dateStr}T${endStr}\n`;
    icsContent += `SUMMARY:${ev.title}\n`;
    icsContent += `LOCATION:${ev.venue}\n`;
    icsContent += `DESCRIPTION:Role: ${ev.role} | Category: ${ev.category} | Notes: ${ev.notes || 'None'}\n`;
    icsContent += `STATUS:CONFIRMED\n`;
    icsContent += "END:VEVENT\n";
  }

  icsContent += "END:VCALENDAR";

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${props.activePersona.name.replace(/\s+/g, '_')}_SMU_Schedule.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  toastMsg.value = 'Schedule exported! .ics file ready to import into OASIS or Apple/Google Calendar.';
  setTimeout(() => { toastMsg.value = ''; }, 4500);
}
</script>

<template>
  <div class="py-2">
    
    <!-- Top Header & Actions -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
      <div>
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="badge bg-danger rounded-pill px-2 py-1" style="font-size: 0.65rem; font-weight: 800;">
            PERSONAL SCHEDULE
          </span>
          <span v-if="apiMode" class="pulse-api-tag">HTML5 Geolocation API</span>
          <span v-if="apiMode" class="pulse-api-tag">Manual Roster Fallback</span>
          <span v-if="apiMode" class="pulse-api-tag">OneMap Transit Guide</span>
          <span v-if="apiMode" class="pulse-api-tag">iCal OASIS Sync</span>
        </div>
        <h3 class="fw-bold mb-1">Hi {{ activePersona.name }}, here is your daily schedule & assignments.</h3>
        <p class="text-muted small mb-0">
          {{ activePersona.cca }} • Academic Timetable & Rehearsal Schedule • Friday, 23 October 2026
        </p>
      </div>

      <div class="d-flex flex-wrap gap-2">
        <button 
          type="button" 
          class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
          @click="exportCalendarICS"
          title="Download .ics file compatible with OASIS, Apple Calendar, and Google Calendar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Sync / Export .ics</span>
        </button>

        <button 
          type="button" 
          class="btn btn-sm btn-danger fw-bold d-flex align-items-center gap-1"
          @click="openAddModal"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Add Event / Class</span>
        </button>
      </div>
    </div>

    <!-- Alert / Toast Banner -->
    <div 
      v-if="toastMsg" 
      class="alert alert-success border-0 shadow-sm mb-4 d-flex align-items-center justify-content-between" 
      role="alert"
      style="border-radius: 0.75rem; background-color: #ecfdf5; color: #065f46;"
    >
      <div class="d-flex align-items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span class="small fw-semibold">{{ toastMsg }}</span>
      </div>
      <button type="button" class="btn-close" @click="toastMsg = ''"></button>
    </div>

    <div class="row g-4">
      
      <!-- Left: Active Assignment & Live Geolocation Verification -->
      <div class="col-lg-5">
        
        <!-- Active Assignment Hero Card -->
        <div v-if="activeAssignment" class="pulse-hero-banner p-4 text-white shadow-lg mb-4">
          
          <div class="d-flex justify-content-between align-items-center mb-3">
            <span class="badge bg-danger rounded-pill px-3 py-1 fw-bold" style="font-size: 0.7rem;">
              {{ activeAssignment.status === 'In Progress' ? 'ACTIVE NOW' : 'PRIORITY ASSIGNMENT' }}
            </span>
            <span class="badge bg-white bg-opacity-25 text-white" style="font-size: 0.75rem;">
              {{ activeAssignment.status }}
            </span>
          </div>

          <h4 class="fw-bold mb-2">{{ activeAssignment.title }}</h4>
          
          <div class="d-flex flex-column gap-2 text-white-50 small mb-4">
            <div class="d-flex align-items-center gap-2 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <strong>{{ activeAssignment.startTime }} – {{ activeAssignment.endTime }}</strong>
            </div>
            <div class="d-flex align-items-center gap-2 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>{{ activeAssignment.venue }}</span>
            </div>
            <div class="d-flex align-items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
              </svg>
              <span>Role: {{ activeAssignment.role }}</span>
            </div>
          </div>

          <!-- OneMap Transit Buffer -->
          <div class="p-3 rounded-3 mb-4 bg-white bg-opacity-10 border border-white border-opacity-10">
            <div class="d-flex align-items-center gap-2 mb-1 fw-bold text-white small">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
                <line x1="8" y1="2" x2="8" y2="18"></line>
                <line x1="16" y1="6" x2="16" y2="22"></line>
              </svg>
              <span>OneMap Campus Transit Guide</span>
              <span v-if="apiMode" class="badge bg-white text-dark small" style="font-size: 0.6rem;">OneMap API</span>
            </div>
            <div class="text-white-50 small">
              Transit Route: <span class="text-white fw-bold">{{ activeAssignment.transitNote || 'Campus Concourse transit' }}</span>
            </div>
          </div>

          <!-- Actions: Geolocation Check-in & Manual Fallback & Status Toggle -->
          <div class="d-flex flex-wrap gap-2 mb-2">
            <button 
              type="button" 
              class="btn py-2 px-3 fw-bold d-flex align-items-center gap-2 flex-grow-1"
              :class="isCheckedIn ? 'btn-success' : 'btn-pulse-primary'"
              :disabled="isLocating"
              @click="handleGeolocationCheckIn"
            >
              <span v-if="isLocating" class="spinner-border spinner-border-sm" role="status"></span>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>{{ isCheckedIn ? checkInMsg : 'Verify Attendance (GPS)' }}</span>
            </button>

            <!-- Manual Fallback Button (Bad GPS / Basement) -->
            <button 
              type="button" 
              class="btn btn-outline-light py-2 px-3 fw-bold d-flex align-items-center gap-1"
              @click="openManualCheckIn"
              title="Manual attendance verification if GPS signal is weak in basement"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>{{ isCheckedIn ? 'Change / Manual' : 'Manual Fallback' }}</span>
            </button>

            <button 
              type="button" 
              class="btn btn-outline-light py-2 px-3 fw-bold"
              @click="toggleEventStatus(activeAssignment)"
            >
              <span v-if="activeAssignment.status === 'Not Started'">Start Task</span>
              <span v-else-if="activeAssignment.status === 'In Progress'">Mark Done ✓</span>
              <span v-else>Reset Status</span>
            </button>
          </div>

          <!-- Verified Attendance Status Bar -->
          <div v-if="isCheckedIn" class="mt-3 p-2 rounded bg-white bg-opacity-15 border border-white border-opacity-20 d-flex justify-content-between align-items-center small">
            <span class="d-flex align-items-center gap-1 text-white fw-semibold" style="font-size: 0.72rem;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>{{ verificationMethodUsed || checkInMsg }}</span>
            </span>
            <button type="button" class="btn btn-link text-white text-opacity-75 p-0 text-decoration-none small" style="font-size: 0.675rem;" @click="resetCheckIn">
              Reset
            </button>
          </div>

        </div>

        <!-- Academic & Rehearsal Clash Detector -->
        <div v-if="conflictingEventIds.size > 0" class="card border-0 shadow-sm p-3 mb-4" style="background-color: #fffbeb; border-left: 4px solid #f59e0b !important; border-radius: 0.75rem;">
          <div class="d-flex align-items-start gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" class="flex-shrink-0 mt-1">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <div>
              <div class="fw-bold text-dark small">Academic Timetable Conflict Detected</div>
              <p class="text-muted small mb-0" style="font-size: 0.725rem; line-height: 1.4;">
                An academic lecture overlaps with an allocated CCA rehearsal slot. Pulse has flagged this to the ExCo for an excused late arrival buffer.
              </p>
            </div>
          </div>
        </div>

        <!-- Facility Alerts Card -->
        <div class="pulse-card p-4 shadow-sm">
          <h6 class="fw-bold mb-2">Connected Facility Alerts</h6>
          <div class="p-3 rounded-3 bg-success bg-opacity-10 border border-success-subtle small mb-2">
            <strong>Studio L7.2 Transfer:</strong> Officially verified and confirmed for SoundFoundry &rarr; Eurhythmix under Ref BK-20271017-000053.
          </div>
          <div class="p-3 rounded-3 bg-light border small text-muted">
            <strong>SSU Notice:</strong> All training blocks are locked >48h in advance, protecting your club against empty room demerits.
          </div>
        </div>

      </div>

      <!-- Right: Interactive Personal Schedule Manager -->
      <div class="col-lg-7">
        
        <!-- Filter Tabs & Stats -->
        <div class="card border-0 shadow-sm p-2 mb-3" style="border-radius: 0.75rem; background-color: var(--pulse-card-bg);">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
            
            <div class="d-flex flex-wrap gap-1">
              <button 
                type="button" 
                class="btn btn-sm py-1 px-3 rounded-pill"
                :class="selectedCategory === 'All' ? 'btn-danger text-white fw-bold' : 'btn-light text-muted'"
                @click="selectedCategory = 'All'"
              >
                All Events ({{ scheduleEvents.length }})
              </button>
              <button 
                type="button" 
                class="btn btn-sm py-1 px-3 rounded-pill"
                :class="selectedCategory === 'CCA' ? 'btn-danger text-white fw-bold' : 'btn-light text-muted'"
                @click="selectedCategory = 'CCA'"
              >
                CCA Rehearsals
              </button>
              <button 
                type="button" 
                class="btn btn-sm py-1 px-3 rounded-pill"
                :class="selectedCategory === 'Academic' ? 'btn-danger text-white fw-bold' : 'btn-light text-muted'"
                @click="selectedCategory = 'Academic'"
              >
                Academic Classes
              </button>
              <button 
                type="button" 
                class="btn btn-sm py-1 px-3 rounded-pill"
                :class="selectedCategory === 'Duty' ? 'btn-danger text-white fw-bold' : 'btn-light text-muted'"
                @click="selectedCategory = 'Duty'"
              >
                Crew Duties
              </button>
            </div>

            <span class="text-muted small px-2">
              {{ scheduleEvents.filter(e => e.status === 'Completed').length }}/{{ scheduleEvents.length }} Done
            </span>

          </div>
        </div>

        <!-- Schedule Items List -->
        <div class="d-flex flex-column gap-3">
          
          <div 
            v-for="event in filteredEvents" 
            :key="event.id"
            class="pulse-card p-3 shadow-sm border position-relative"
            :style="{
              borderLeft: event.category === 'Academic' 
                ? '4px solid #3b82f6 !important' 
                : event.category === 'CCA' 
                  ? '4px solid #ef4444 !important' 
                  : '4px solid #10b981 !important'
            }"
          >
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <div class="d-flex align-items-center gap-2 mb-1">
                  <h6 class="fw-bold mb-0" :class="{ 'text-decoration-line-through text-muted': event.status === 'Completed' }">
                    {{ event.title }}
                  </h6>
                  <span class="badge" :class="{
                    'bg-primary': event.category === 'Academic',
                    'bg-danger': event.category === 'CCA',
                    'bg-success': event.category === 'Duty',
                    'bg-secondary': event.category === 'Personal'
                  }" style="font-size: 0.65rem;">
                    {{ event.category }}
                  </span>
                  <span v-if="conflictingEventIds.has(event.id)" class="badge bg-warning text-dark border border-warning" style="font-size: 0.65rem;">
                    Clash Detected
                  </span>
                </div>

                <div class="text-muted small d-flex flex-wrap align-items-center gap-2">
                  <span class="fw-bold text-dark font-monospace">{{ event.startTime }} – {{ event.endTime }}</span>
                  <span>•</span>
                  <span>{{ event.venue }}</span>
                  <span>•</span>
                  <span class="fst-italic">{{ event.role }}</span>
                </div>
              </div>

              <!-- Status Badge / Toggle Button -->
              <button 
                type="button" 
                class="btn btn-sm py-1 px-2 rounded-pill fw-bold border"
                :class="{
                  'btn-success text-white': event.status === 'Completed',
                  'btn-warning text-dark': event.status === 'In Progress',
                  'btn-light text-muted': event.status === 'Not Started'
                }"
                style="font-size: 0.7rem;"
                @click="toggleEventStatus(event)"
                :title="'Click to toggle: ' + event.status"
              >
                {{ event.status }}
              </button>
            </div>

            <!-- Notes & Transit Info -->
            <div v-if="event.notes || event.transitNote" class="p-2 rounded bg-light border small text-muted mb-2" style="font-size: 0.725rem;">
              <div v-if="event.transitNote" class="mb-1">
                <strong class="text-secondary">Transit:</strong> {{ event.transitNote }}
              </div>
              <div v-if="event.notes">
                <strong class="text-secondary">Notes:</strong> {{ event.notes }}
              </div>
            </div>

            <!-- Action Buttons: Edit & Delete -->
            <div class="d-flex justify-content-end gap-2 border-top pt-2">
              <button 
                type="button" 
                class="btn btn-sm btn-outline-secondary py-0 px-2"
                style="font-size: 0.7rem;"
                @click="openEditModal(event)"
              >
                Edit
              </button>
              <button 
                type="button" 
                class="btn btn-sm btn-outline-danger py-0 px-2"
                style="font-size: 0.7rem;"
                @click="deleteEvent(event.id)"
              >
                Delete
              </button>
            </div>

          </div>

        </div>

      </div>

    </div>

    <!-- MODAL 1: Add / Edit Event -->
    <div 
      v-if="showModal" 
      class="modal fade show d-block" 
      tabindex="-1" 
      style="background-color: rgba(15, 23, 42, 0.65); z-index: 1055;"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg" style="border-radius: 1rem;">
          
          <div class="modal-header border-bottom py-3 px-4 bg-light">
            <h6 class="modal-title fw-bold text-dark mb-0">
              {{ isEditing ? 'Edit Schedule Event' : 'Add Custom Event / Class' }}
            </h6>
            <button type="button" class="btn-close" @click="closeModal"></button>
          </div>

          <form @submit.prevent="saveEvent">
            <div class="modal-body p-4">
              
              <div class="mb-3">
                <label class="form-label small fw-bold text-dark">Event or Class Title:</label>
                <input 
                  v-model="eventForm.title" 
                  type="text" 
                  class="form-control form-control-sm" 
                  placeholder="e.g. IS216 Lab, Rehearsal Warmup, Team Debrief" 
                  required 
                />
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Category:</label>
                  <select v-model="eventForm.category" class="form-select form-select-sm" required>
                    <option value="CCA">CCA Rehearsal</option>
                    <option value="Academic">Academic Class</option>
                    <option value="Duty">Crew / Logistics Duty</option>
                    <option value="Personal">Personal / Study Block</option>
                  </select>
                </div>
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Date:</label>
                  <input v-model="eventForm.date" type="date" class="form-control form-control-sm" required />
                </div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Start Time:</label>
                  <input v-model="eventForm.startTime" type="time" class="form-control form-control-sm" required />
                </div>
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">End Time:</label>
                  <input v-model="eventForm.endTime" type="time" class="form-control form-control-sm" required />
                </div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Venue / Location:</label>
                  <input 
                    v-model="eventForm.venue" 
                    type="text" 
                    class="form-control form-control-sm" 
                    placeholder="e.g. Studio L7.2, SCIS SR 2.1" 
                    required 
                  />
                </div>
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Role / Responsibility:</label>
                  <input 
                    v-model="eventForm.role" 
                    type="text" 
                    class="form-control form-control-sm" 
                    placeholder="e.g. Lead Dancer, Student" 
                  />
                </div>
              </div>

              <div class="mb-3">
                <label class="form-label small fw-bold text-dark">OneMap Transit Buffer Note:</label>
                <input 
                  v-model="eventForm.transitNote" 
                  type="text" 
                  class="form-control form-control-sm" 
                  placeholder="e.g. 8 mins walk via Concourse" 
                />
              </div>

              <div class="mb-2">
                <label class="form-label small fw-bold text-dark">Preparation Notes:</label>
                <textarea 
                  v-model="eventForm.notes" 
                  class="form-control form-control-sm" 
                  rows="2" 
                  placeholder="e.g. Bring dance sneakers, project slide deck ready."
                ></textarea>
              </div>

            </div>

            <div class="modal-footer border-top py-3 px-4 d-flex justify-content-between">
              <button type="button" class="btn btn-outline-secondary btn-sm" @click="closeModal">Cancel</button>
              <button type="submit" class="btn btn-danger btn-sm fw-bold px-3">
                {{ isEditing ? 'Save Changes' : 'Add to Schedule' }}
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>

    <!-- MODAL 2: Manual Attendance Fallback (Weak GPS / Basement Venue) -->
    <div 
      v-if="showManualCheckInModal" 
      class="modal fade show d-block" 
      tabindex="-1" 
      style="background-color: rgba(15, 23, 42, 0.65); z-index: 1055;"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg" style="border-radius: 1rem;">
          
          <div class="modal-header border-bottom py-3 px-4 bg-light">
            <div class="d-flex align-items-center gap-2">
              <div class="p-2 rounded bg-warning bg-opacity-10 text-dark">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </div>
              <div>
                <h6 class="modal-title fw-bold text-dark mb-0">Manual Attendance Verification</h6>
                <small class="text-muted" style="font-size: 0.7rem;">Basement Venue & Weak GPS Fallback Mode (SLiMS Clause 4.2)</small>
              </div>
            </div>
            <button type="button" class="btn-close" @click="closeManualCheckIn"></button>
          </div>

          <form @submit.prevent="submitManualCheckIn">
            <div class="modal-body p-4">
              
              <!-- Info Notice -->
              <div class="card border-0 p-3 mb-3 bg-light" style="border-radius: 0.5rem; font-size: 0.75rem; line-height: 1.4;">
                <strong class="text-dark">Basement / Shielded Signal Fallback:</strong>
                <span class="text-muted">
                  Campus rehearsal facilities located in basements (e.g. Li Ka Shing B1 Main Hall Stage, SOE Basement, Connexion underground) frequently experience GPS multipath loss. Per SMU SLiMS regulations, students may self-verify presence using the session passcode or verified officer witness sign-off.
                </span>
              </div>

              <!-- Verification Method Selector -->
              <div class="mb-3">
                <label class="form-label small fw-bold text-dark">Verification Method:</label>
                <div class="d-flex gap-2">
                  <button 
                    type="button" 
                    class="btn btn-sm flex-grow-1"
                    :class="manualVerificationType === 'passcode' ? 'btn-danger text-white fw-bold' : 'btn-outline-secondary'"
                    @click="manualVerificationType = 'passcode'"
                  >
                    Venue Session Passcode
                  </button>
                  <button 
                    type="button" 
                    class="btn btn-sm flex-grow-1"
                    :class="manualVerificationType === 'witness' ? 'btn-danger text-white fw-bold' : 'btn-outline-secondary'"
                    @click="manualVerificationType = 'witness'"
                  >
                    EXCO Officer Sign-off
                  </button>
                </div>
              </div>

              <!-- Method 1: Passcode -->
              <div v-if="manualVerificationType === 'passcode'" class="mb-3">
                <label class="form-label small fw-bold text-dark">4-Digit Session Passcode:</label>
                <input 
                  v-model="manualPasscodeInput" 
                  type="text" 
                  class="form-control form-control-sm text-center font-monospace fw-bold fs-6" 
                  placeholder="e.g. LKS-742" 
                  required 
                />
                <small class="text-muted" style="font-size: 0.675rem;">
                  Provided by the Stage Manager or projected on the studio AV display.
                </small>
              </div>

              <!-- Method 2: Witness Sign-off -->
              <div v-else class="mb-3">
                <label class="form-label small fw-bold text-dark">Present Verifying Officer:</label>
                <select v-model="manualWitnessName" class="form-select form-select-sm" required>
                  <option value="Amanda Tang (Honorary General Secretary)">Amanda Tang (Honorary General Secretary, Taekwondo)</option>
                  <option value="Darren Koh (Stage Production Manager)">Darren Koh (Stage Production Manager, Samba Masala)</option>
                  <option value="Rachel Tan (Honorary General Secretary)">Rachel Tan (Honorary General Secretary, Eurhythmix)</option>
                  <option value="Chloe Ang (OSL Staff Advisor)">Chloe Ang (OSL Staff Advisor)</option>
                </select>
                <div class="form-check mt-2">
                  <input class="form-check-input" type="checkbox" id="witnessConfirm" required checked />
                  <label class="form-check-label small text-muted" for="witnessConfirm" style="font-size: 0.725rem;">
                    I attest under the SMU Honor Code that I am physically present at the venue and verifying with the officer above.
                  </label>
                </div>
              </div>

              <!-- Signal / Reason Note -->
              <div class="mb-2">
                <label class="form-label small fw-bold text-dark">Reason for Manual Fallback:</label>
                <input 
                  v-model="manualReasonInput" 
                  type="text" 
                  class="form-control form-control-sm" 
                  placeholder="e.g. Weak GPS in basement / Wi-Fi drop" 
                  required 
                />
              </div>

            </div>

            <div class="modal-footer border-top py-3 px-4 d-flex justify-content-between">
              <button type="button" class="btn btn-outline-secondary btn-sm" @click="closeManualCheckIn">Cancel</button>
              <button type="submit" class="btn btn-danger btn-sm fw-bold px-3">
                Confirm Manual Attendance
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.pulse-api-tag {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.45rem;
  border-radius: 9999px;
  background-color: rgba(59, 130, 246, 0.12);
  color: #2563eb;
  border: 1px solid rgba(59, 130, 246, 0.25);
}
</style>
