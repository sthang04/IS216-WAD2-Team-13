/** Telegram sendMessage conventions match the original calendar sender.
 * Uses the SAME backend TELEGRAM_BOT_TOKEN, never another bot or browser secret.
 * No retry: a timeout may mean Telegram accepted the message already. */
export function createTelegramTransport({botToken,fetchImpl=fetch,timeoutMs=10000}) {
 return async ({chatId,title,body,link}) => {
  let response,result
  try {
   response=await fetchImpl('https://api.telegram.org/bot'+botToken+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},
    signal:AbortSignal.timeout(timeoutMs),
    body:JSON.stringify({chat_id:String(chatId),text:'Pulse: '+title+'\n'+body,
     reply_markup:{inline_keyboard:[[{text:'Open in Pulse',url:link}]]}})
   })
   result=await response.json()
  } catch {
   // Never return fetch errors: they can contain the bot-token URL.
   return {status:'UNKNOWN'}
  }
  if(!response.ok || result?.ok!==true)return {status:'FAILED'}
  if(result?.result?.message_id==null)return {status:'UNKNOWN'}
  return {status:'SENT'}
 }
}
