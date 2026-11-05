// Prints the schema installation used for the older staging project, without executing SQL.
// Reuses actual application migrations; excludes demo reset/seeding and delivery cron jobs.
import {readFileSync} from 'node:fs'
const read=file=>readFileSync(new URL(file,import.meta.url),'utf8')
console.log('-- PULSE-Staging only. Schema installation; inspect before applying.\nbegin;')
console.log(read('./calendarPrerequisites.sql'))
for(const name of ['20261024000100_pulse_align_schema.sql','20261024000200_pulse_logic.sql','20261103000200_pulse_meeting_scheduler.sql','20261103000300_pulse_meeting_multi_per_week.sql','20261103000400_pulse_meeting_agenda.sql','20261103000500_pulse_meeting_edit.sql','20261104000100_pulse_ops_events.sql','20261104000200_pulse_ops_event_times.sql','20261105080229_telegram_alert_wiring.sql','20261105083942_simulator_telegram_worker_auth.sql']){
 let sql=read('../../supabase/migrations/'+name)
 // Two old metadata comments refer to columns removed from the current app schema.
 sql=sql.replace(/^comment on column members\.(?:club_name|role_code) is .*;[\r]?$/gm,'-- Obsolete column comment omitted; application behavior is unchanged.')
 console.log(sql)
}
console.log(read('./resetTestBooking.sql'))
console.log('commit;')
