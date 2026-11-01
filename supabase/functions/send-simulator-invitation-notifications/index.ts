import {createClient} from 'jsr:@supabase/supabase-js@2'
import {createSimulatorInvitationHandler} from '../_shared/simulatorInvitationWorker.js'

// Reuse project-wide backend configuration. No new bot/token, browser trigger,
// invocation of send-telegram-notifications, or changes to its scheduled job.
const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
Deno.serve(createSimulatorInvitationHandler({client,env:Deno.env}))
