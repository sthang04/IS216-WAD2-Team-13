<script setup>
// NotificationBell.vue
// The bell in the navbar and its drop-down list of notifications.

import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { session, showToast } from '../services/sessionState'
import { markRead, createTelegramLinkCode } from '../services/notificationService'
import {
  notificationStore,
  unreadCount,
  loadNotifications,
  removeNotification,
  clearAllNotifications
} from '../services/notificationStore'
import NotificationSwipeItem from './NotificationSwipeItem.vue'

const router = useRouter()
const ringing = ref(false)
const root = ref(null)
const botName = import.meta.env.VITE_TELEGRAM_BOT_USERNAME
let ringTimer = null

// Shake the bell for 1.2 seconds (motion only, no sound)
function ring() {
  ringing.value = false
  requestAnimationFrame(() => {
    ringing.value = true
  })
  clearTimeout(ringTimer)
  ringTimer = setTimeout(() => {
    ringing.value = false
  }, 1200)
}

// ringTick goes up when there is something new
watch(() => notificationStore.value.ringTick, ring)

// Reload the list every time the panel opens
watch(() => notificationStore.value.bellOpen, (isOpen) => {
  if (isOpen) {
    loadNotifications()
  }
})

// Close when pressing outside the bell, or with Escape.
// We use pointerdown (not click) so Pip's "Open notifications" button still works.
function closeOnOutside(event) {
  if (notificationStore.value.bellOpen && root.value && !root.value.contains(event.target)) {
    notificationStore.value.bellOpen = false
  }
}

function closeOnEscape(event) {
  if (event.key === 'Escape') {
    notificationStore.value.bellOpen = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside)
  document.addEventListener('keydown', closeOnEscape)
})

onUnmounted(() => {
  clearTimeout(ringTimer)
  document.removeEventListener('pointerdown', closeOnOutside)
  document.removeEventListener('keydown', closeOnEscape)
})

function toggle() {
  notificationStore.value.bellOpen = !notificationStore.value.bellOpen
}

async function openItem(item) {
  notificationStore.value.bellOpen = false
  if (!item.is_read) {
    item.is_read = true
    try {
      await markRead(item.id)
    } catch (error) {
      console.log(error.message)
    }
  }
  if (item.link_path) {
    router.push(item.link_path)
  }
}

async function markAll() {
  notificationStore.value.items.forEach((item) => {
    item.is_read = true
  })
  try {
    await markRead(null)
  } catch (error) {
    console.log(error.message)
  }
}

async function deleteItem(item) {
  try {
    await removeNotification(item.id)
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
}

async function clearAll() {
  if (!confirm('Delete all notifications?')) {
    return
  }
  try {
    await clearAllNotifications()
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
}

// Opens the Telegram bot with "/start <code>"; the telegram-webhook
// function then links that chat to this member
async function connectTelegram() {
  if (!botName) {
    showToast('Set VITE_TELEGRAM_BOT_USERNAME in .env to connect Telegram.', 'danger')
    return
  }
  try {
    const code = await createTelegramLinkCode()
    const name = botName.replace('@', '')
    window.open('https://t.me/' + name + '?start=' + encodeURIComponent(code), '_blank', 'noopener')
  } catch (error) {
    console.log(error.message)
    showToast(error.message, 'danger')
  }
}

defineExpose({ reload: loadNotifications })
</script>

<template>
  <div ref="root" class="position-relative">
    <button
      type="button"
      class="pulse-icon-btn position-relative"
      :class="{ 'pulse-bell-ring': ringing }"
      :aria-label="`Notifications, ${unreadCount} unread`"
      :aria-expanded="notificationStore.bellOpen"
      :disabled="!session.memberId"
      @click="toggle"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
      <span v-if="unreadCount" class="pulse-unread">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </button>

    <div v-if="notificationStore.bellOpen" class="pulse-dropdown pf-notification-panel">
      <div class="d-flex justify-content-between align-items-center px-3 py-2 border-bottom">
        <strong class="small">Notifications</strong>
        <div class="d-flex align-items-center gap-3">
          <button v-if="unreadCount" type="button" class="btn btn-link btn-sm p-0" @click="markAll">Mark all read</button>
          <button v-if="notificationStore.items.length" type="button" class="btn btn-link btn-sm p-0 text-danger" @click="clearAll">Clear all</button>
          <button type="button" class="btn-close btn-sm ms-1" aria-label="Close notifications" @click="notificationStore.bellOpen = false"></button>
        </div>
      </div>
      <div class="pulse-notification-list">
        <p v-if="!notificationStore.items.length" class="small text-muted p-3 mb-0">Nothing yet.</p>
        <TransitionGroup name="pulse-swipe">
          <NotificationSwipeItem
            v-for="item in notificationStore.items"
            :key="item.id"
            :item="item"
            @open="openItem"
            @delete="deleteItem"
          />
        </TransitionGroup>
      </div>
      <p v-if="notificationStore.items.length" class="pulse-tiny text-muted text-center mb-0 py-1 border-top">Swipe left on a notification to delete it</p>
      <div v-if="botName" class="d-flex gap-2 px-3 py-2 border-top">
        <button v-if="botName" type="button" class="btn btn-sm btn-outline-secondary" @click="connectTelegram">Connect Telegram</button>
      </div>
    </div>
  </div>
</template>
