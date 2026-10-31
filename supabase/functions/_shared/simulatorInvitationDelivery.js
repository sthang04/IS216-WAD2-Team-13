/** Server-side extension point, NOT a new Telegram bot. A deployed handler must
 * authenticate the organizer, load this persisted invitation itself, and inject
 * the team's existing single-recipient notification sender. Never accept message
 * details or recipient identity straight from a browser. No sender exists here.
 * Accept/Decline stays inside Pulse; Telegram buttons are intentionally omitted. */
export async function deliverSimulatorInvitation(invitation,{origin,sendExistingNotification}={}) {
  if(typeof sendExistingNotification!=='function') throw new Error('Existing Telegram sender adapter is not connected.')
  const url=new URL(origin)
  if(url.protocol!=='https:' || url.username || url.password) throw new Error('A trusted HTTPS Pulse origin is required.')
  if(!invitation?.id || invitation.status!=='Pending' || Date.parse(invitation.expires_at)<=Date.now() ||
    !Number.isFinite(Date.parse(invitation.expires_at)) || !invitation.recipient_member_id || !invitation.assignment_snapshot?.length) throw new Error('Invitation is not deliverable.')
  url.pathname='/events'; url.search=''; url.hash=''; url.searchParams.set('replacementInvitation',invitation.id)
  if(typeof invitation.event_name!=='string' || invitation.assignment_snapshot.some(a=>!a || typeof a.activity!=='string' || typeof a.role_name!=='string' || !Number.isFinite(Date.parse(a.starts_at)) || !Number.isFinite(Date.parse(a.ends_at)) || Date.parse(a.starts_at)>=Date.parse(a.ends_at))) throw new Error('Persisted invitation terms are invalid.')
  const activities=invitation.assignment_snapshot.map(a=>a.activity+' | '+a.role_name+' | '+a.starts_at+' to '+a.ends_at).join('\n')
  const result=await sendExistingNotification({recipientMemberId:invitation.recipient_member_id,
    idempotencyKey:'simulator-invitation:'+invitation.id,title:'Pulse Replacement Invitation',
    body:invitation.event_name+'\n'+activities+'\nOpen Pulse to Accept or Decline. Acceptance does not apply the assignment.',link:url.toString()})
  // A queued request is not a delivered message. Report only the backend's
  // confirmed send outcome; a crash/retry needs the existing sender's idempotency.
  if(result?.status!=='Sent' || !result.messageId) throw new Error('Telegram send was not confirmed by the backend.')
  return {status:'Sent',messageId:String(result.messageId)}
}
