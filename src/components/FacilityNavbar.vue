<script setup>
// FacilityNavbar.vue
// Top bar of the facility pages: who you are, which CCA you act for,
// the notification bell, and (demo only) the persona switcher.

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import NotificationBell from './NotificationBell.vue'
import {
  session,
  activeMembership,
  canManageActiveClub,
  switchPersona,
  setActiveClub,
  showToast
} from '../services/sessionState'
import { startNotifications } from '../services/notificationStore'
import { resetDemoData } from '../services/facilityService'

// embedded = running inside the team app, which owns sign-in, the theme and the main navbar
const props = defineProps({ embedded: { type: Boolean, default: false } })
const emit = defineEmits(['data-reset'])
const router = useRouter()

const personaOpen = ref(false)
const resetting = ref(false)

const personaMenu = ref(null)

// ---------------- Persona menu (demo mode) ----------------

function canManageAny(person) {
  for (let i = 0; i < person.memberships.length; i++) {
    if (person.memberships[i].can_manage_facilities) {
      return true
    }
  }
  return false
}

// Group the demo people by what they are allowed to do
const personaGroups = computed(() => {
  const directors = []
  const oslAdmins = []
  const viewOnly = []
  const publicViewers = []

  session.value.personas.forEach((person) => {
    if (canManageAny(person)) {
      directors.push(person)
    } else if (person.is_osl_admin) {
      oslAdmins.push(person)
    } else if (person.memberships.length > 0) {
      viewOnly.push(person)
    } else {
      publicViewers.push(person)
    }
  })

  return [
    { label: 'Logistics Directors', people: directors },
    { label: 'OSL Administrators', people: oslAdmins },
    { label: 'CCA Members — View Only', people: viewOnly },
    { label: 'Public Viewers', people: publicViewers }
  ]
})

// The coloured role badge
const role = computed(() => {
  if (session.value.isOslAdmin && !activeMembership.value) {
    return { label: 'OSL Admin', cls: 'pulse-role-osl' }
  }
  if (!activeMembership.value) {
    return { label: 'Public viewer', cls: 'pulse-role-public' }
  }
  if (canManageActiveClub.value) {
    return { label: 'Logistics Director', cls: 'pulse-role-ld' }
  }
  return { label: activeMembership.value.role_name + ' · view only', cls: 'pulse-role-view' }
})

// 'Rachel Tan' -> 'RT'
function initials(name) {
  const words = (name || 'P V').split(' ')
  let result = ''
  for (let i = 0; i < words.length && i < 2; i++) {
    result += words[i][0]
  }
  return result.toUpperCase()
}

function personaSubtitle(person) {
  if (person.is_osl_admin) {
    return 'OSL Administrator'
  }
  if (person.memberships.length === 0) {
    return 'Public viewer'
  }
  const parts = []
  person.memberships.forEach((m) => {
    parts.push(m.club_name + ' · ' + m.role_name)
  })
  return parts.join(', ')
}

function choosePersona(person) {
  if (!session.value.demoMode || session.value.authUserId) {
    return
  }
  switchPersona(person.member_id)
  startNotifications() // reload the bell for the new person
  personaOpen.value = false
  showToast('Now viewing as ' + person.full_name, 'info')

  // Take them to the page that suits their role
  if (person.is_osl_admin && person.memberships.length === 0) {
    router.push('/facilities/admin')
  } else if (session.value.activeClubId) {
    router.push('/facilities/my-club')
  } else {
    router.push('/facilities')
  }
}

// "Acting for" drop-down
function changeClub(event) {
  setActiveClub(Number(event.target.value))
  startNotifications() // offers belong to the CCA, so reload them
}

async function resetDemo() {
  if (!confirm('Reset all demo transfers, waitlists and notifications?')) {
    return
  }
  resetting.value = true
  try {
    await resetDemoData()
    showToast('Demo data reset.', 'success')
    emit('data-reset')
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
  resetting.value = false
}



function closeOnOutsideClick(event) {
  if (personaOpen.value && personaMenu.value && !personaMenu.value.contains(event.target)) {
    personaOpen.value = false
  }
}


onMounted(() => {
  document.addEventListener('click', closeOnOutsideClick)
})


onUnmounted(() => {
  document.removeEventListener('click', closeOnOutsideClick)
})
</script>

<template>
  <header class="pf-header">
    <div class="container-xl d-flex flex-wrap align-items-center gap-2 py-2">
      <RouterLink to="/facilities" class="pulse-brand text-decoration-none">
        <span class="pulse-logo">P<span class="pf-logo-dot"></span></span>
        <span>{{ embedded ? 'Facility Calendar' : 'Pulse' }}</span>
      </RouterLink>

      <div class="d-flex align-items-center gap-2 ms-auto flex-wrap justify-content-end">
        <div v-if="session.memberships.length" class="input-group input-group-sm pulse-club-select">
          <span class="input-group-text">{{ canManageActiveClub ? 'Acting for' : 'Viewing' }}</span>
          <select
            class="form-select form-select-sm fw-semibold"
            :value="session.activeClubId"
            aria-label="Selected CCA"
            @change="changeClub"
          >
            <option v-for="m in session.memberships" :key="m.club_id" :value="m.club_id">
              {{ m.club_name }}{{ m.can_manage_facilities ? '' : ' (view only)' }}
            </option>
          </select>
        </div>

        <span class="pulse-role" :class="role.cls">{{ role.label }}</span>

        <button
          v-if="(session.demoMode && !session.authUserId) || (embedded && session.isOslAdmin)"
          type="button"
          class="btn btn-sm btn-outline-danger rounded-pill"
          :disabled="resetting"
          @click="resetDemo"
        >
          <span v-if="resetting" class="spinner-border spinner-border-sm me-1"></span>{{ resetting ? 'Resetting' : 'Reset demo' }}
        </button>

    

        <NotificationBell />

        <div v-if="!embedded" ref="personaMenu" class="position-relative">
          <button
            type="button"
            class="pulse-persona-btn"
            :aria-expanded="personaOpen"
            :disabled="!session.demoMode || !!session.authUserId"
            @click="personaOpen = !personaOpen"
          >
            <span class="pulse-avatar">{{ initials(session.memberName) }}</span>
            <span class="d-none d-sm-inline fw-semibold">{{ session.memberName || 'Public viewer' }}</span>
            <span v-if="session.demoMode && !session.authUserId" aria-hidden="true" class="pulse-tiny">▾</span>
          </button>

          <Transition name="pop">
            <div v-if="personaOpen" class="pulse-dropdown pulse-persona-panel">
              <div class="px-3 pt-2 pb-1 pulse-eyebrow">Demo persona</div>
              <template v-for="group in personaGroups" :key="group.label">
                <div v-if="group.people.length" class="px-3 pt-2 pulse-tiny text-muted fw-bold text-uppercase">{{ group.label }}</div>
                <button
                  v-for="person in group.people"
                  :key="person.member_id"
                  type="button"
                  class="pulse-persona-item"
                  :class="{ active: person.member_id === session.memberId }"
                  @click="choosePersona(person)"
                >
                  <span class="pulse-avatar pulse-avatar-sm">{{ initials(person.full_name) }}</span>
                  <span>
                    <span class="fw-semibold small d-block">{{ person.full_name }}</span>
                    <span class="pulse-tiny text-muted d-block">{{ personaSubtitle(person) }}</span>
                  </span>
                </button>
              </template>
              <p class="pulse-tiny text-muted px-3 py-2 mb-0 border-top">
                Demo only. With real sign-in, the database checks your actual memberships.
              </p>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </header>
</template>
