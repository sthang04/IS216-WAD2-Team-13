
// Reads and clears the signed-in member's notifications (the bell),
// and creates the code that links their Telegram account.
 
import { supabase } from '../supabase'
import { demoMemberId } from './sessionState'
 
// The bell only loads the latest 30 notifications, so it stays fast as old ones pile up
export const NOTIFICATION_LIMIT = 30
 
// Latest notifications for the current member
export async function fetchMyNotifications() {
  const response = await supabase.rpc('rpc_my_notifications', {
    p_demo_member_id: demoMemberId(),
    p_limit: NOTIFICATION_LIMIT
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}
 
// Mark one notification as read, or all of them when id is null
export async function markRead(notificationId) {
  const response = await supabase.rpc('rpc_mark_notifications_read', {
    p_notification_id: notificationId,
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}
 
// Delete one notification, or all of them when id is null ("Clear all")
export async function deleteNotifications(notificationId) {
  const response = await supabase.rpc('rpc_delete_notifications', {
    p_notification_id: notificationId,
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}
 
// A one-time code for "Connect Telegram". The bot reads it from /start <code>.
export async function createTelegramLinkCode() {
  const response = await supabase.rpc('rpc_create_telegram_link_code', {
    p_demo_member_id: demoMemberId()
  })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}

// true when the signed-in person's Telegram is linked to the bot.
// Returns false (instead of failing) if the database function isn't installed yet.
export async function fetchTelegramLinked() {
  const response = await supabase.rpc('rpc_my_telegram_link')
  if (response.error) {
    console.log(response.error.message)
    return false
  }
  return response.data === true
}

// Requests a Telegram account-linking code from Supabase.
// The PostgreSQL RPC generates the code.
// Supabase Edge Functions handle Telegram Bot API communication.
// Hence security -> as no Telegram Bot Token is exposed in the Vue frontend.
 
// Supabase Realtime: run onNewNotification whenever a notification is added into the website NOT webpush notififcation
// Returns a function that stops listening.
export function listenForNotifications(memberId, onNewNotification) {
  const channel = supabase
    .channel('notifications-' + memberId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'recipient_member_id=eq.' + memberId },
      onNewNotification
    )
    .subscribe()
 
  function stopListening() {
    supabase.removeChannel(channel)
  }
  return stopListening
}
 
// "5m ago", "2h ago", ...
export function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) {
    return 'just now'
  } else if (seconds < 3600) {
    return Math.floor(seconds / 60) + 'm ago'
  } else if (seconds < 86400) {
    return Math.floor(seconds / 3600) + 'h ago'
  } else {
    return Math.floor(seconds / 86400) + 'd ago'
  }
}