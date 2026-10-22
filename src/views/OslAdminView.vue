<script setup>
import { ref, computed } from 'vue';
import { 
  SMU_CLUBS_DIRECTORY, 
  SSU_DEMERIT_POLICY, 
  calculateWaitlistCutoff, 
  generateTransferEmailPayload 
} from '../services/smuClubsDirectory';

const props = defineProps({
  slots: { type: Array, required: true },
  apiMode: { type: Boolean, default: false }
});

const emit = defineEmits(['endorse-transfer', 'reject-transfer', 'lock-facility', 'reset-db']);

const toastMsg = ref('');
const selectedTab = ref('approvals'); // 'approvals', 'slims', 'venues', 'demerit'

// Modal states
const selectedSlotForSlip = ref(null);
const showViolationModal = ref(false);

// Violation logging form state
const violationForm = ref({
  clubName: 'SMU SoundFoundry',
  infractionType: 'Empty Room Hogging (<48h unreleased no-show - SSU Clause 9.1c)',
  venueName: 'Studio L7.2 (Dance)',
  fbsRef: 'BK-20271016-000045',
  points: 2,
  notes: 'Security patrol verified facility was unoccupied during allocated rehearsal slot with zero advance release submitted.'
});

// Mock SLiMS Endorsement Submissions from Clubs (SMU Student Life Management System)
const slimsSubmissions = ref([
  {
    id: 'SLIMS-2026-001',
    club: 'SMU Eurhythmix',
    activityName: 'SMU Arts Festival Opening Night Tech Rehearsal',
    category: 'Arts Performance / Leadership',
    date: 'Fri, 16 Oct 2026',
    venue: 'Main Hall Stage, Li Ka Shing B1',
    attendedCount: 42,
    totalCount: 45,
    attendanceRate: 93.3,
    status: 'Pending Endorsement',
    submittedBy: 'Rachel Tan (Honorary General Secretary)',
    verifiedMethod: 'Mobile HTML5 Geolocation Pin (within 50m)',
    isEndorsed: false
  },
  {
    id: 'SLIMS-2026-002',
    club: 'SMU Taekwondo',
    activityName: 'SUniG 2026 Sparring & Poomsae Clinic',
    category: 'Sports Competition / Training',
    date: 'Sat, 17 Oct 2026',
    venue: 'Gym Studio & Admin L3',
    attendedCount: 28,
    totalCount: 30,
    attendanceRate: 93.3,
    status: 'Pending Endorsement',
    submittedBy: 'Amanda Tang (Honorary General Secretary)',
    verifiedMethod: 'QR Attendance Roster & Coach Endorsement',
    isEndorsed: false
  },
  {
    id: 'SLIMS-2026-003',
    club: 'SMU Chinese Orchestra',
    activityName: 'Semester 1 Chamber Rehearsal Session',
    category: 'Arts Performance',
    date: 'Wed, 14 Oct 2026',
    venue: 'Studio L7.1 (Music)',
    attendedCount: 22,
    totalCount: 24,
    attendanceRate: 91.7,
    status: 'Endorsed',
    submittedBy: 'Li Wei (Honorary General Secretary)',
    verifiedMethod: 'Mobile Geolocation Check-in',
    isEndorsed: true
  }
]);

// Institutional Demerit and Compliance Log (From SSU & ACF Handbooks)
const clubComplianceLog = ref([
  {
    club: 'SMU Eurhythmix',
    cluster: 'Arts & Cultural Fraternity (ACF)',
    demeritPoints: 0,
    standing: 'Good Standing',
    lastAudit: '15 Oct 2026',
    notes: '100% SLiMS compliance. All slot releases submitted >48h in advance under SSU Clause 9.1(c).'
  },
  {
    club: 'SMU Chinese Orchestra',
    cluster: 'Arts & Cultural Fraternity (ACF)',
    demeritPoints: 0,
    standing: 'Good Standing',
    lastAudit: '16 Oct 2026',
    notes: 'Proactive slot release submitted >48h in advance. Full venue handover compliance.'
  },
  {
    club: 'SMU Stageit',
    cluster: 'Arts & Cultural Fraternity (ACF)',
    demeritPoints: 1,
    standing: 'Warning Issued',
    lastAudit: '12 Oct 2026',
    notes: 'Late cancellation notification (<24 hours) for Studio L7.1 rehearsal. Formal warning logged.'
  },
  {
    club: 'SMU SoundFoundry',
    cluster: 'Arts & Cultural Fraternity (ACF)',
    demeritPoints: 2,
    standing: 'Conditional Standing',
    lastAudit: '17 Oct 2026',
    notes: 'Empty Room Hogging: Unreleased slot unattended at Music Drama Lab (MDL). 2 Demerit Points logged.'
  },
  {
    club: 'SMU Taekwondo',
    cluster: 'SMU Sports Union (SSU)',
    demeritPoints: 0,
    standing: 'Good Standing',
    lastAudit: '14 Oct 2026',
    notes: 'SSOP Safety certified. Certified First Aider present at all training blocks in Gym Studio.'
  }
]);

// Actionable queue: Slots claimed by a club awaiting OSL sign-off (Dual-stage gatekeeper)
const pendingTransfers = computed(() => {
  return props.slots.filter(s => s.status === 'Pending Admin Sign-off');
});

// Informational: Slots open on marketplace seeking swap partners
const openMarketplaceSlots = computed(() => {
  return props.slots.filter(s => s.status === 'Proposed Peer Transfer');
});

// Officially confirmed transfers
const confirmedTransfers = computed(() => {
  return props.slots.filter(s => s.status === 'Officially Confirmed');
});

// Administrative metrics
const totalVenues = computed(() => props.slots.length);
const pendingCount = computed(() => pendingTransfers.value.length);
const marketplaceCount = computed(() => openMarketplaceSlots.value.length);
const pendingSlimsCount = computed(() => slimsSubmissions.value.filter(s => !s.isEndorsed).length);
const totalDemeritViolations = computed(() => clubComplianceLog.value.filter(c => c.demeritPoints > 0).length);

function endorseSlims(item) {
  item.isEndorsed = true;
  item.status = 'Endorsed';
  toastMsg.value = `SLiMS Submission ${item.id} (${item.club}) endorsed by Chloe Ang! Records are now visible on students' official Interim CCA transcripts.`;
  setTimeout(() => { toastMsg.value = ''; }, 4500);
}

function handleEndorseSlot(slot) {
  emit('endorse-transfer', slot);
  toastMsg.value = `Dual-Stage Endorsement complete for ${slot.venue_name}! Slot transfer from ${slot.owner_club} to ${slot.claiming_club} is officially confirmed under Ref: ${slot.fbs_ref || slot.audit_ticket_id || 'BK-20271017-000053'}.`;
  setTimeout(() => { toastMsg.value = ''; }, 4500);
}

function handleRejectSlot(slot) {
  emit('reject-transfer', slot);
  toastMsg.value = `Proposed transfer for ${slot.venue_name} rejected. Slot reverted to marketplace to prevent unauthorized room squatting.`;
  setTimeout(() => { toastMsg.value = ''; }, 4500);
}

function lockForUniversityEvent(slot) {
  slot.status = 'Officially Confirmed';
  slot.owner_club = 'OSL University Event (Patron\'s Day)';
  slot.claiming_club = null;
  toastMsg.value = `Administrative Lock applied to ${slot.venue_name}! Reserved for university-wide event under SSU Clause 9.1(e).`;
  setTimeout(() => { toastMsg.value = ''; }, 4500);
}

// Open FBS electronic transfer slip preview
function openTransferSlip(slot) {
  selectedSlotForSlip.value = slot;
}

function closeTransferSlip() {
  selectedSlotForSlip.value = null;
}

function confirmTransferFromSlip(slot) {
  handleEndorseSlot(slot);
  closeTransferSlip();
}

// Violation logging modal controls
function openViolationModal() {
  showViolationModal.value = true;
}

function closeViolationModal() {
  showViolationModal.value = false;
}

function submitViolation() {
  const form = violationForm.value;
  const existing = clubComplianceLog.value.find(c => c.club.toLowerCase() === form.clubName.toLowerCase());
  
  const pointsToAdd = Number(form.points) || 1;
  let newTotal = pointsToAdd;
  
  if (existing) {
    existing.demeritPoints += pointsToAdd;
    newTotal = existing.demeritPoints;
    existing.lastAudit = '21 Oct 2026';
    existing.notes = `${form.infractionType}: ${form.notes} (${form.fbsRef || 'Direct Violation'}).`;
    
    // Compute standing
    if (newTotal >= 6) {
      existing.standing = 'Facility Banned (2 Weeks)';
    } else if (newTotal >= 4) {
      existing.standing = 'Priority Downgraded';
    } else if (newTotal >= 2) {
      existing.standing = 'Conditional Standing';
    } else {
      existing.standing = 'Warning Issued';
    }
  } else {
    let standing = 'Warning Issued';
    if (newTotal >= 6) standing = 'Facility Banned (2 Weeks)';
    else if (newTotal >= 4) standing = 'Priority Downgraded';
    else if (newTotal >= 2) standing = 'Conditional Standing';
    
    clubComplianceLog.value.push({
      club: form.clubName,
      cluster: 'Student Organization (SMU)',
      demeritPoints: newTotal,
      standing: standing,
      lastAudit: '21 Oct 2026',
      notes: `${form.infractionType}: ${form.notes} (${form.fbsRef || 'Direct Violation'}).`
    });
  }

  toastMsg.value = `Institutional Demerit Point (${pointsToAdd} pts) logged against ${form.clubName} under SSU Clause 9.1(c)! Formal violation notice dispatched to Club President and OSL Advisor.`;
  closeViolationModal();
  setTimeout(() => { toastMsg.value = ''; }, 5500);
}
</script>

<template>
  <div class="pulse-osl-admin-view">
    
    <!-- Toast Banner -->
    <div 
      v-if="toastMsg" 
      class="alert alert-success alert-dismissible fade show shadow-sm mb-4 border-0 d-flex align-items-center justify-content-between" 
      role="alert"
      style="border-radius: 0.75rem; background-color: #ecfdf5; color: #065f46;"
    >
      <div class="d-flex align-items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span class="small fw-semibold">{{ toastMsg }}</span>
      </div>
      <button type="button" class="btn-close" @click="toastMsg = ''"></button>
    </div>

    <!-- OSL Hero Banner -->
    <div class="pulse-hero-banner mb-4">
      <div class="row align-items-center justify-content-between g-3">
        <div class="col-lg-8">
          <div class="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill bg-danger bg-opacity-10 text-danger fw-bold small mb-2 border border-danger border-opacity-25" style="font-size: 0.75rem;">
            <span>Office of Student Life (OSL)</span>
            <span>•</span>
            <span>Staff Administration Console</span>
          </div>
          <h2 class="display-6 fw-bold mb-1 text-white" style="letter-spacing: -0.02em;">
            Campus Facility Governance & Dual-Stage Approvals
          </h2>
          <p class="text-white text-opacity-75 mb-0 small" style="max-width: 680px; line-height: 1.5;">
            University-wide administrative command center for the Office of Student Life. Review peer facility transfers, enforce anti-squatting rules under SSU Clause 9.1(c) and ACF Constitution Section 5.2.7, endorse SLiMS co-curricular records, and administer institutional demerits.
          </p>
        </div>

        <div class="col-lg-4 text-lg-end">
          <div class="d-inline-flex flex-column align-items-lg-end gap-1 p-3 rounded-3 bg-white bg-opacity-10 border border-white border-opacity-10">
            <span class="text-white text-opacity-75 small">Active Administrator:</span>
            <span class="fw-bold text-white fs-6">Chloe Ang</span>
            <span class="badge bg-danger text-white border border-danger small" style="font-size: 0.675rem;">
              Supervisory Authority (OSL / OCIS)
            </span>
          </div>
        </div>
      </div>

      <!-- KPI Metrics Ribbon -->
      <div class="row g-2 mt-3 pt-3 border-top border-white border-opacity-10">
        <div class="col-6 col-md-3">
          <div class="p-2 rounded-2 bg-white bg-opacity-10">
            <div class="text-white text-opacity-75 small" style="font-size: 0.7rem;">Monitored Venues</div>
            <div class="fs-4 fw-bold text-white">{{ totalVenues }}</div>
            <div class="text-white text-opacity-50 small" style="font-size: 0.65rem;">Campus Studios & Courts</div>
          </div>
        </div>

        <div class="col-6 col-md-3">
          <div class="p-2 rounded-2 bg-white bg-opacity-10">
            <div class="text-white text-opacity-75 small" style="font-size: 0.7rem;">Pending OSL Sign-offs</div>
            <div class="fs-4 fw-bold text-warning">{{ pendingCount }}</div>
            <div class="text-white text-opacity-50 small" style="font-size: 0.65rem;">Requires Dual-Stage Endorsement</div>
          </div>
        </div>

        <div class="col-6 col-md-3">
          <div class="p-2 rounded-2 bg-white bg-opacity-10">
            <div class="text-white text-opacity-75 small" style="font-size: 0.7rem;">SLiMS Endorsement Queue</div>
            <div class="fs-4 fw-bold text-info">{{ pendingSlimsCount }}</div>
            <div class="text-white text-opacity-50 small" style="font-size: 0.65rem;">Attendance Awaiting Review</div>
          </div>
        </div>

        <div class="col-6 col-md-3">
          <div class="p-2 rounded-2 bg-white bg-opacity-10">
            <div class="text-white text-opacity-75 small" style="font-size: 0.7rem;">Institutional Violations</div>
            <div class="fs-4 fw-bold" :class="totalDemeritViolations > 0 ? 'text-danger' : 'text-success'">{{ totalDemeritViolations }}</div>
            <div class="text-white text-opacity-50 small" style="font-size: 0.65rem;">SSU & ACF Demerit Log</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Navigation Tab Switcher for Admin Hub -->
    <div class="card border-0 shadow-sm p-2 mb-4" style="border-radius: 0.75rem; background-color: var(--pulse-card-bg);">
      <div class="d-flex flex-wrap gap-2">
        <button 
          type="button" 
          class="pulse-filter-pill"
          :class="{ active: selectedTab === 'approvals' }"
          @click="selectedTab = 'approvals'"
        >
          <span>Dual-Stage Transfer Approvals</span>
          <span class="badge ms-1" :class="pendingCount > 0 ? 'bg-danger text-white' : 'bg-secondary text-white'">
            {{ pendingCount }}
          </span>
        </button>

        <button 
          type="button" 
          class="pulse-filter-pill"
          :class="{ active: selectedTab === 'slims' }"
          @click="selectedTab = 'slims'"
        >
          <span>SLiMS Activity Endorsements</span>
          <span class="badge ms-1" :class="pendingSlimsCount > 0 ? 'bg-info text-white' : 'bg-secondary text-white'">
            {{ pendingSlimsCount }}
          </span>
        </button>

        <button 
          type="button" 
          class="pulse-filter-pill"
          :class="{ active: selectedTab === 'venues' }"
          @click="selectedTab = 'venues'"
        >
          <span>All Monitored Venues ({{ totalVenues }})</span>
        </button>

        <button 
          type="button" 
          class="pulse-filter-pill"
          :class="{ active: selectedTab === 'demerit' }"
          @click="selectedTab = 'demerit'"
        >
          <span>Institutional Demerit Ledger</span>
          <span v-if="totalDemeritViolations > 0" class="badge ms-1 bg-warning text-dark">
            {{ totalDemeritViolations }}
          </span>
        </button>
      </div>
    </div>

    <!-- TAB 1: Dual-Stage Transfer Approvals -->
    <section v-if="selectedTab === 'approvals'" class="mb-4">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 class="fw-bold mb-0">Dual-Stage Transfer Approval Queue</h5>
          <small class="text-muted" style="font-size: 0.75rem;">
            Feature 3 Core Requirement: Student CCAs negotiate peer swaps, but institutional policy requires OSL Administrator endorsement before bookings are officially confirmed.
          </small>
        </div>
        <span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 py-1 px-2" style="font-size: 0.7rem;">
          Anti-Squatting Compliance Engine Active
        </span>
      </div>

      <!-- Standing Orders & Waitlist Cutoff Notice Banner -->
      <div class="card border-0 shadow-sm p-3 mb-4" style="background-color: #f8fafc; border-left: 4px solid #3b82f6 !important; border-radius: 0.75rem;">
        <div class="d-flex align-items-start gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" class="flex-shrink-0 mt-1">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <div>
            <div class="fw-bold text-dark small">Waitlist Cut-off Protection Active (Anti-Demerit Safeguard)</div>
            <p class="text-muted small mb-0" style="font-size: 0.75rem; line-height: 1.4;">
              To prevent unfair last-minute slot dumping, waitlist queues automatically close: <strong>10:00 PM previous night</strong> for morning slots (08:00 - 13:00) and <strong>12:00 PM noon</strong> for evening slots. Unfilled slots convert to open Flash Marketplace. Queued clubs are never auto-assigned slots without consent, shielding students from unintentional no-show demerits.
            </p>
          </div>
        </div>
      </div>

      <!-- Actionable Queue: Pending Admin Sign-off -->
      <div class="mb-4">
        <h6 class="fw-bold text-dark d-flex align-items-center gap-2 mb-2" style="font-size: 0.85rem;">
          <span>Action Required: Awaiting OSL Sign-Off ({{ pendingTransfers.length }})</span>
          <span v-if="pendingTransfers.length" class="badge bg-danger text-white" style="font-size: 0.65rem;">Immediate Review</span>
        </h6>

        <div v-if="!pendingTransfers.length" class="card border-0 shadow-sm p-4 text-center mb-3" style="border-radius: 0.85rem; background-color: var(--pulse-card-bg);">
          <div class="py-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-success mb-2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <div class="fw-bold small text-dark">Action Queue Cleared</div>
            <p class="text-muted small mb-0" style="font-size: 0.75rem;">All claimed peer transfers have been reviewed. Zero pending requests currently require OSL sign-off.</p>
          </div>
        </div>

        <div v-else class="row g-3 mb-3">
          <div v-for="slot in pendingTransfers" :key="slot.id" class="col-12">
            <div class="pulse-card p-4 shadow-sm border" style="border-left: 4px solid #ef4444 !important;">
              <div class="row align-items-center g-3">
                <div class="col-lg-5">
                  <div class="d-flex align-items-center gap-2 mb-1">
                    <h6 class="fw-bold mb-0 fs-6">{{ slot.venue_name }}</h6>
                    <span class="pulse-tag">{{ slot.venue_type }}</span>
                    <span class="badge bg-danger text-white small" style="font-size: 0.65rem;">
                      Pending Admin Sign-off
                    </span>
                  </div>
                  <div class="text-muted small d-flex align-items-center gap-1 mb-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <span>{{ slot.building_location }}</span>
                    <span>•</span>
                    <span>{{ slot.event_date || 'Friday, 16 Oct' }} ({{ slot.time_slot }})</span>
                  </div>
                  <div class="small text-muted">
                    <strong>Official FBS Ref:</strong> <span class="pulse-audit-ticket">{{ slot.fbs_ref || slot.audit_ticket_id || 'BK-20271017-000053' }}</span>
                  </div>
                </div>

                <div class="col-lg-4">
                  <div class="p-2 rounded-2 bg-light border small">
                    <div class="d-flex justify-content-between mb-1">
                      <span class="text-muted">Releasing CCA:</span>
                      <strong class="text-dark">{{ slot.owner_club }}</strong>
                    </div>
                    <div class="d-flex justify-content-between mb-1">
                      <span class="text-muted">Claiming CCA:</span>
                      <strong class="text-primary">{{ slot.claiming_club }}</strong>
                    </div>
                    <div class="d-flex justify-content-between border-top pt-1 mt-1">
                      <span class="text-muted">SSU 9.1(c) Compliance:</span>
                      <span class="text-success fw-bold">Released >48h Advance</span>
                    </div>
                  </div>
                </div>

                <div class="col-lg-3 text-lg-end d-flex flex-column gap-2 justify-content-center">
                  <button 
                    type="button" 
                    class="btn btn-sm btn-outline-primary py-1 d-flex align-items-center justify-content-center gap-1"
                    style="font-size: 0.75rem;"
                    @click="openTransferSlip(slot)"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                    <span>Preview FBS Transfer Slip</span>
                  </button>

                  <button 
                    type="button" 
                    class="btn btn-sm btn-success fw-bold py-2 d-flex align-items-center justify-content-center gap-1"
                    @click="handleEndorseSlot(slot)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>Endorse & Confirm Booking</span>
                  </button>

                  <button 
                    type="button" 
                    class="btn btn-sm btn-outline-danger py-1"
                    style="font-size: 0.725rem;"
                    @click="handleRejectSlot(slot)"
                  >
                    Reject & Revert to Marketplace
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Marketplace Oversight: Open Peer Transfer Listings -->
      <div class="mb-4">
        <h6 class="fw-bold text-dark d-flex align-items-center gap-2 mb-2" style="font-size: 0.85rem;">
          <span>Active Peer Transfer Proposals on Marketplace ({{ openMarketplaceSlots.length }})</span>
          <span class="badge bg-secondary text-white" style="font-size: 0.65rem;">Monitoring</span>
        </h6>

        <div class="row g-3">
          <div v-for="slot in openMarketplaceSlots" :key="slot.id" class="col-md-6">
            <div class="pulse-card p-3 shadow-sm border" style="border-left: 4px solid #f59e0b !important;">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <h6 class="fw-bold mb-0 text-dark">{{ slot.venue_name }}</h6>
                  <span class="text-muted small">{{ slot.building_location }} • {{ slot.time_slot }}</span>
                </div>
                <span class="badge bg-warning bg-opacity-25 text-dark border border-warning small" style="font-size: 0.65rem;">
                  Proposed Peer Transfer
                </span>
              </div>
              <div class="p-2 rounded-2 bg-light border small">
                <div class="d-flex justify-content-between">
                  <span class="text-muted">Listed by:</span>
                  <strong class="text-dark">{{ slot.owner_club }}</strong>
                </div>
                <div class="d-flex justify-content-between mt-1">
                  <span class="text-muted">Status:</span>
                  <span class="text-muted fst-italic">Open on marketplace; awaiting peer claim</span>
                </div>
                <div class="d-flex justify-content-between mt-1 border-top pt-1">
                  <span class="text-muted">FBS Reference:</span>
                  <span class="font-monospace small text-primary">{{ slot.fbs_ref || 'BK-20271016-000028' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Officially Confirmed Bookings -->
      <div v-if="confirmedTransfers.length" class="mb-4">
        <h6 class="fw-bold text-dark d-flex align-items-center gap-2 mb-2" style="font-size: 0.85rem;">
          <span>Officially Confirmed Transfers ({{ confirmedTransfers.length }})</span>
          <span class="badge bg-success text-white" style="font-size: 0.65rem;">Audit Trail Active</span>
        </h6>

        <div class="row g-3">
          <div v-for="slot in confirmedTransfers" :key="slot.id" class="col-md-6">
            <div class="pulse-card p-3 shadow-sm border" style="border-left: 4px solid #10b981 !important;">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <h6 class="fw-bold mb-0 text-dark">{{ slot.venue_name }}</h6>
                  <span class="text-muted small">{{ slot.building_location }} • {{ slot.time_slot }}</span>
                </div>
                <span class="badge bg-success text-white small" style="font-size: 0.65rem;">
                  Officially Confirmed
                </span>
              </div>
              <div class="p-2 rounded-2 bg-light border small">
                <div class="d-flex justify-content-between">
                  <span class="text-muted">Confirmed Assignee:</span>
                  <strong class="text-success">{{ slot.owner_club }}</strong>
                </div>
                <div class="d-flex justify-content-between mt-1">
                  <span class="text-muted">Endorsed By:</span>
                  <span class="text-dark">Chloe Ang (OSL Staff Advisor)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 2: SLiMS Activity Endorsements -->
    <section v-if="selectedTab === 'slims'" class="mb-4">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 class="fw-bold mb-0">SLiMS Co-Curricular Verification Queue</h5>
          <small class="text-muted" style="font-size: 0.75rem;">
            SMU Student Life Management System (SLiMS): OSL Staff Advisors must review and endorse verified student activity attendance before entries appear on official undergraduate transcripts.
          </small>
        </div>
        <span class="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25 py-1 px-2" style="font-size: 0.7rem;">
          End-of-Term Cutoff: 31 Dec
        </span>
      </div>

      <div class="row g-3">
        <div v-for="item in slimsSubmissions" :key="item.id" class="col-12">
          <div class="pulse-card p-4 shadow-sm border" :style="item.isEndorsed ? 'border-left: 4px solid #10b981 !important;' : 'border-left: 4px solid #06b6d4 !important;'">
            <div class="row align-items-center g-3">
              <div class="col-lg-5">
                <div class="d-flex align-items-center gap-2 mb-1">
                  <h6 class="fw-bold mb-0 fs-6">{{ item.activityName }}</h6>
                  <span class="badge" :class="item.isEndorsed ? 'bg-success' : 'bg-info'">{{ item.status }}</span>
                </div>
                <div class="text-muted small mb-2">
                  <strong>{{ item.club }}</strong> • {{ item.category }} • {{ item.date }}
                </div>
                <div class="small text-muted">
                  <strong>Location:</strong> {{ item.venue }}<br>
                  <strong>Verified Via:</strong> {{ item.verifiedMethod }}
                </div>
              </div>

              <div class="col-lg-4">
                <div class="p-2 rounded-2 bg-light border small">
                  <div class="d-flex justify-content-between mb-1">
                    <span class="text-muted">Registered Headcount:</span>
                    <strong class="text-dark">{{ item.totalCount }} Students</strong>
                  </div>
                  <div class="d-flex justify-content-between mb-1">
                    <span class="text-muted">Verified Attendance:</span>
                    <strong class="text-success">{{ item.attendedCount }} ({{ item.attendanceRate }}%)</strong>
                  </div>
                  <div class="d-flex justify-content-between border-top pt-1 mt-1">
                    <span class="text-muted">Submission Lead:</span>
                    <span class="text-dark fw-semibold" style="font-size: 0.7rem;">{{ item.submittedBy }}</span>
                  </div>
                </div>
              </div>

              <div class="col-lg-3 text-lg-end">
                <button 
                  v-if="!item.isEndorsed"
                  type="button" 
                  class="btn btn-sm btn-info text-white fw-bold py-2 w-100 d-flex align-items-center justify-content-center gap-1"
                  @click="endorseSlims(item)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Endorse for Official CCA Record</span>
                </button>
                <div v-else class="text-success small fw-bold d-flex align-items-center justify-content-lg-end gap-1">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Endorsed on SLiMS Transcript</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 3: All Monitored Venues -->
    <section v-if="selectedTab === 'venues'" class="mb-4">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 class="fw-bold mb-0">University-Wide Facility Inventory</h5>
          <small class="text-muted" style="font-size: 0.75rem;">
            Real-time status across all campus cultural and athletic rehearsal facilities, featuring FBS reference audit IDs and waitlist cutoff timers.
          </small>
        </div>
      </div>

      <div class="row g-3">
        <div v-for="slot in slots" :key="slot.id" class="col-md-6 col-lg-4">
          <div class="pulse-card h-100 p-3 shadow-sm d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <h6 class="fw-bold mb-0 text-dark">{{ slot.venue_name }}</h6>
                  <span class="text-muted small">{{ slot.building_location }}</span>
                </div>
                <span class="badge" :class="{
                  'bg-success': slot.status === 'Officially Confirmed',
                  'bg-warning text-dark': slot.status === 'Proposed Peer Transfer',
                  'bg-danger text-white': slot.status === 'Pending Admin Sign-off',
                  'bg-primary': slot.status === 'Booked'
                }">
                  {{ slot.status }}
                </span>
              </div>

              <div class="p-2 rounded-2 bg-light border small mb-2">
                <div class="d-flex justify-content-between mb-1">
                  <span class="text-muted">Current Assignee:</span>
                  <strong class="text-dark">{{ slot.owner_club }}</strong>
                </div>
                <div v-if="slot.claiming_club" class="d-flex justify-content-between mb-1">
                  <span class="text-muted">Proposed Transfer:</span>
                  <strong class="text-primary">{{ slot.claiming_club }}</strong>
                </div>
                <div class="d-flex justify-content-between mb-1">
                  <span class="text-muted">Time Slot:</span>
                  <span class="text-dark font-monospace">{{ slot.time_slot }}</span>
                </div>
                <div class="d-flex justify-content-between border-top pt-1 mt-1">
                  <span class="text-muted">FBS Reference:</span>
                  <span class="font-monospace small text-primary">{{ slot.fbs_ref || 'BK-20271016-000012' }}</span>
                </div>
              </div>

              <!-- Waitlist Cutoff Rule Tag -->
              <div class="p-2 rounded-2 mb-3 bg-white border small d-flex align-items-center justify-content-between">
                <span class="text-muted" style="font-size: 0.7rem;">Waitlist Cutoff:</span>
                <span class="badge bg-secondary bg-opacity-10 text-secondary border fw-normal" style="font-size: 0.65rem;">
                  {{ calculateWaitlistCutoff(slot.time_slot).cutoffText }}
                </span>
              </div>
            </div>

            <!-- Admin Actions -->
            <div class="d-flex gap-2">
              <button 
                v-if="slot.status === 'Pending Admin Sign-off'"
                type="button" 
                class="btn btn-sm btn-success flex-grow-1 fw-bold"
                @click="handleEndorseSlot(slot)"
              >
                Endorse Sign-Off
              </button>
              <button 
                v-else-if="slot.status === 'Proposed Peer Transfer'"
                type="button" 
                class="btn btn-sm btn-outline-warning flex-grow-1"
                style="font-size: 0.7rem;"
                @click="toastMsg = 'Slot is currently listed on marketplace for peer matching.'"
              >
                Open on Marketplace
              </button>
              <button 
                v-else
                type="button" 
                class="btn btn-sm btn-outline-secondary flex-grow-1"
                style="font-size: 0.7rem;"
                @click="lockForUniversityEvent(slot)"
              >
                Lock for Uni Event
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 4: Institutional Demerit Ledger -->
    <section v-if="selectedTab === 'demerit'" class="mb-4">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 class="fw-bold mb-0">Institutional Demerit & Compliance Ledger</h5>
          <small class="text-muted" style="font-size: 0.75rem;">
            Enforcing the progressive penalty scale from SSU Handbook Clause 9.1(c) and ACF Constitution Section 5.2.7.
          </small>
        </div>
        <button 
          type="button"
          class="btn btn-sm btn-danger fw-bold d-flex align-items-center gap-1"
          @click="openViolationModal"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Issue Violation Notice</span>
        </button>
      </div>

      <!-- SSU Clause 9.1(c) Standing Order Banner -->
      <div class="card border-0 shadow-sm p-3 mb-4" style="background-color: #fef2f2; border-left: 4px solid #ef4444 !important; border-radius: 0.75rem;">
        <div class="d-flex align-items-start gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" class="flex-shrink-0 mt-1">
            <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>
            <div class="fw-bold text-dark small">Empty Room Hogging Policy: SSU Handbook Clause 9.1(c) & ACF Section 5.2.7</div>
            <p class="text-muted small mb-0" style="font-size: 0.75rem; line-height: 1.4;">
              If a student club holds a facility slot, does not show up (no-show), and fails to release it into the Pulse marketplace at least <strong>48 hours in advance</strong>, OSL logs an Institutional Demerit Point. Repeated infractions trigger escalating sanctions up to a mandatory 2-week campus facility usage ban and budgetary forfeiture.
            </p>
          </div>
        </div>
      </div>

      <!-- 4-Tier Penalty Matrix Card Grid -->
      <div class="row g-2 mb-4">
        <div v-for="tier in SSU_DEMERIT_POLICY.penaltyTiers" :key="tier.level" class="col-6 col-md-3">
          <div class="p-3 rounded-2 bg-white border shadow-sm h-100">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="badge" :class="{
                'bg-warning text-dark': tier.level === 1,
                'bg-orange text-white': tier.level === 2,
                'bg-danger text-white': tier.level >= 3
              }" style="font-size: 0.65rem;">
                Tier {{ tier.level }}
              </span>
              <span class="fw-bold text-dark" style="font-size: 0.75rem;">{{ tier.points }} Points</span>
            </div>
            <div class="fw-bold text-dark small mb-1">{{ tier.action }}</div>
            <p class="text-muted mb-0" style="font-size: 0.7rem; line-height: 1.3;">{{ tier.consequence }}</p>
          </div>
        </div>
      </div>

      <!-- Active Demerit Log Table -->
      <div class="pulse-card p-0 shadow-sm overflow-hidden border">
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead class="table-light">
              <tr style="font-size: 0.75rem; text-transform: uppercase;">
                <th class="ps-4">Student Organization</th>
                <th>Constituent Cluster</th>
                <th>Demerit Points</th>
                <th>Standing</th>
                <th>Last Audit</th>
                <th class="pe-4">Compliance Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="club in clubComplianceLog" :key="club.club" style="font-size: 0.8rem;">
                <td class="ps-4 fw-bold text-dark">{{ club.club }}</td>
                <td class="text-muted">{{ club.cluster }}</td>
                <td>
                  <span class="badge" :class="{
                    'bg-success': club.demeritPoints === 0,
                    'bg-warning text-dark': club.demeritPoints === 1,
                    'bg-danger text-white': club.demeritPoints >= 2
                  }">
                    {{ club.demeritPoints }} Points
                  </span>
                </td>
                <td>
                  <span class="badge" :class="{
                    'bg-success-subtle text-success border border-success': club.standing === 'Good Standing',
                    'bg-warning-subtle text-dark border border-warning': club.standing === 'Warning Issued' || club.standing === 'Conditional Standing',
                    'bg-danger-subtle text-danger border border-danger': club.standing.includes('Banned') || club.standing.includes('Downgraded')
                  }">
                    {{ club.standing }}
                  </span>
                </td>
                <td class="text-muted">{{ club.lastAudit }}</td>
                <td class="pe-4 text-muted small">{{ club.notes }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- MODAL 1: Authentic SMU FBS Booking Transfer Slip Preview -->
    <div 
      v-if="selectedSlotForSlip" 
      class="modal fade show d-block" 
      tabindex="-1" 
      style="background-color: rgba(15, 23, 42, 0.65); z-index: 1055;"
    >
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content border-0 shadow-lg" style="border-radius: 1rem;">
          
          <div class="modal-header border-bottom py-3 px-4 bg-light">
            <div class="d-flex align-items-center gap-2">
              <div class="p-2 rounded bg-danger bg-opacity-10 text-danger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
              </div>
              <div>
                <h6 class="modal-title fw-bold text-dark mb-0">Official SMU FBS Electronic Booking Transfer Slip</h6>
                <small class="text-muted" style="font-size: 0.7rem;">Facility Booking System (FBS) • Office of Student Life (OSL)</small>
              </div>
            </div>
            <button type="button" class="btn-close" @click="closeTransferSlip"></button>
          </div>

          <div class="modal-body p-4">
            
            <!-- Slip Header Details -->
            <div class="card border p-3 mb-3 bg-light" style="border-radius: 0.5rem;">
              <div class="row g-2 text-dark small">
                <div class="col-md-6">
                  <span class="text-muted">Booking Reference:</span>
                  <div class="fw-bold font-monospace text-primary fs-6">{{ selectedSlotForSlip.fbs_ref || selectedSlotForSlip.audit_ticket_id || 'BK-20271017-000053' }}</div>
                </div>
                <div class="col-md-6">
                  <span class="text-muted">Official Timestamp:</span>
                  <div class="fw-semibold">21 Oct 2026, 21:30 SGT</div>
                </div>
                <div class="col-md-6">
                  <span class="text-muted">Dispatch From:</span>
                  <div class="font-monospace text-dark">artsvenues@smu.edu.sg</div>
                </div>
                <div class="col-md-6">
                  <span class="text-muted">OSL Advisor Oversight:</span>
                  <div class="font-monospace text-dark">eechiing@smu.edu.sg (Chloe Ang / Staff Advisor)</div>
                </div>
                <div class="col-12 border-top pt-2 mt-1">
                  <span class="text-muted">Routing CC Recipients:</span>
                  <div class="font-monospace small text-secondary">
                    artsvenuesfacility@sa.smu.edu.sg, artsvenues@smu.edu.sg, {{ selectedSlotForSlip.owner_club.toLowerCase().replace(/\s+/g, '') }}@sa.smu.edu.sg
                  </div>
                </div>
              </div>
            </div>

            <!-- Transfer Terms -->
            <div class="card border-0 p-3 mb-3" style="background-color: #f0fdf4; border-radius: 0.5rem;">
              <h6 class="fw-bold text-success mb-2" style="font-size: 0.85rem;">Compliance & Demerit Indemnification Clause</h6>
              <p class="text-success text-opacity-85 small mb-0" style="font-size: 0.75rem; line-height: 1.5;">
                In accordance with <strong>SSU Handbook Clause 9.1(c)</strong> and <strong>ACF Operating Regulations</strong>, this facility booking for <strong>{{ selectedSlotForSlip.venue_name }}</strong> ({{ selectedSlotForSlip.time_slot }}) is formally reassigned from <strong>{{ selectedSlotForSlip.owner_club }}</strong> to <strong>{{ selectedSlotForSlip.claiming_club }}</strong>. The releasing club has fulfilled advance release requirements and is fully indemnified against empty-room demerit points.
              </p>
            </div>

            <!-- Venue Specifications -->
            <div class="border rounded p-3 small">
              <div class="row g-2">
                <div class="col-6">
                  <span class="text-muted">Facility:</span>
                  <div class="fw-bold text-dark">{{ selectedSlotForSlip.venue_name }}</div>
                </div>
                <div class="col-6">
                  <span class="text-muted">Campus Location:</span>
                  <div class="fw-bold text-dark">{{ selectedSlotForSlip.building_location }}</div>
                </div>
                <div class="col-6">
                  <span class="text-muted">Rehearsal Schedule:</span>
                  <div class="fw-bold text-dark">{{ selectedSlotForSlip.event_date || 'Friday, 16 Oct' }} ({{ selectedSlotForSlip.time_slot }})</div>
                </div>
                <div class="col-6">
                  <span class="text-muted">Transferee CCA:</span>
                  <div class="fw-bold text-primary">{{ selectedSlotForSlip.claiming_club }}</div>
                </div>
              </div>
            </div>

          </div>

          <div class="modal-footer border-top py-3 px-4 d-flex justify-content-between">
            <button type="button" class="btn btn-outline-secondary btn-sm" @click="closeTransferSlip">Cancel</button>
            <button 
              type="button" 
              class="btn btn-success btn-sm fw-bold px-3 d-flex align-items-center gap-1"
              @click="confirmTransferFromSlip(selectedSlotForSlip)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Endorse & Transmit FBS Slip</span>
            </button>
          </div>

        </div>
      </div>
    </div>

    <!-- MODAL 2: Issue Institutional Demerit Point / Log Violation -->
    <div 
      v-if="showViolationModal" 
      class="modal fade show d-block" 
      tabindex="-1" 
      style="background-color: rgba(15, 23, 42, 0.65); z-index: 1055;"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg" style="border-radius: 1rem;">
          
          <div class="modal-header border-bottom py-3 px-4 bg-light">
            <div class="d-flex align-items-center gap-2">
              <div class="p-2 rounded bg-danger bg-opacity-10 text-danger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              </div>
              <div>
                <h6 class="modal-title fw-bold text-dark mb-0">Record Institutional Violation & Demerit</h6>
                <small class="text-muted" style="font-size: 0.7rem;">SSU Handbook Clause 9.1(c) • ACF Operating Sanctions</small>
              </div>
            </div>
            <button type="button" class="btn-close" @click="closeViolationModal"></button>
          </div>

          <form @submit.prevent="submitViolation">
            <div class="modal-body p-4">
              
              <div class="mb-3">
                <label class="form-label small fw-bold text-dark">Offending Student Organization:</label>
                <select v-model="violationForm.clubName" class="form-select form-select-sm" required>
                  <option v-for="c in SMU_CLUBS_DIRECTORY" :key="c.name" :value="c.name">
                    {{ c.name }} ({{ c.cluster }})
                  </option>
                </select>
              </div>

              <div class="mb-3">
                <label class="form-label small fw-bold text-dark">Infraction Category:</label>
                <select v-model="violationForm.infractionType" class="form-select form-select-sm" required>
                  <option value="Empty Room Hogging (<48h unreleased no-show - SSU Clause 9.1c)">
                    Empty Room Hogging (&lt;48h unreleased no-show - SSU Clause 9.1c)
                  </option>
                  <option value="Unauthorized Room or Asset Swapping (ACF Rule)">
                    Unauthorized Room or Asset Swapping without OSL / ACF approval
                  </option>
                  <option value="Studio Cleanliness / Equipment Negligence (SSU Clause 9.2c)">
                    Studio Cleanliness / Equipment Negligence (SSU Clause 9.2c)
                  </option>
                  <option value="Stage Riser Manual Push Across Campus Road (ACF Riser Rule)">
                    Stage Riser Manual Push Across Campus Road (ACF Riser Rule)
                  </option>
                </select>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">Facility Involved:</label>
                  <input v-model="violationForm.venueName" type="text" class="form-control form-control-sm" placeholder="e.g. Studio L7.2" required />
                </div>
                <div class="col-6">
                  <label class="form-label small fw-bold text-dark">FBS Reference:</label>
                  <input v-model="violationForm.fbsRef" type="text" class="form-control form-control-sm" placeholder="e.g. BK-20271016-000045" />
                </div>
              </div>

              <div class="mb-3">
                <label class="form-label small fw-bold text-dark">Penalty Points to Log:</label>
                <select v-model.number="violationForm.points" class="form-select form-select-sm" required>
                  <option :value="1">1 Point - Formal Advisory Warning</option>
                  <option :value="2">2 Points - Official Demerit (2nd Infraction)</option>
                  <option :value="4">4 Points - Priority Allocation Downgrade (3rd Infraction)</option>
                  <option :value="6">6 Points - Mandatory 2-Week Facility Ban (4th Infraction)</option>
                </select>
              </div>

              <div class="mb-2">
                <label class="form-label small fw-bold text-dark">Audit Observations & Evidence:</label>
                <textarea 
                  v-model="violationForm.notes" 
                  class="form-control form-control-sm" 
                  rows="2" 
                  placeholder="Record security guard patrol report, timestamp, or photos."
                  required
                ></textarea>
              </div>

            </div>

            <div class="modal-footer border-top py-3 px-4 d-flex justify-content-between">
              <button type="button" class="btn btn-outline-secondary btn-sm" @click="closeViolationModal">Cancel</button>
              <button type="submit" class="btn btn-danger btn-sm fw-bold px-3">
                Log Demerit & Notify President
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.pulse-osl-admin-view {
  animation: fadeIn 0.25s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
