import {supabase} from '../supabase'
import {readSimulatorRows} from './simulatorPaginationService.js'
export const RECOVERY_BOOKING_EVENT='pulse:recovery-booking-claimed'
// The calendar reports an exact successful claim, never a guessed room/time match.
export function reportRecoveryBookingClaim(query,bookingId,clubId){if(typeof query.simRecoveryToken==='string')window.dispatchEvent(new CustomEvent(RECOVERY_BOOKING_EVENT,{detail:{token:query.simRecoveryToken,bookingId,clubId}}))}
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore'}).format(new Date(value))
/** Read visible booking and transfer evidence, including exact saved IDs that
 * may fall outside the current activity date range. This does not claim or
 * associate a booking; the confirmed workflow performs that separate action.
 * @param {{ranges: object[], ids?: (string|number)[], clubId: string|number}} input
 * @returns {Promise<object[]>} Deduplicated bookings with visible transfer decisions.
 */
export async function readRecoveryBookings({ranges,ids=[],clubId}){
 const dates=ranges.flatMap(r=>[r.starts_at,r.ends_at]).filter(v=>Number.isFinite(Date.parse(v))).map(day).sort()
 const groups=await Promise.all([dates.length?readSimulatorRows(supabase,'facility_bookings',q=>q.gte('booking_date',dates[0]).lte('booking_date',dates[dates.length-1])):[],ids.length?readSimulatorRows(supabase,'facility_bookings',q=>q.in('id',ids)):[]])
 const bookings=[...new Map(groups.flat().map(row=>[String(row.id),row])).values()]
 // Rejection relists the booking; its separate transfer retains the actual decision.
 // Read visible transfer evidence, never synthesize approval from room availability.
 const transfers=bookings.length&&clubId!=null?await readSimulatorRows(supabase,'facility_transfers',q=>q.in('booking_id',bookings.map(b=>b.id)).eq('claiming_club_id',clubId)):[]
 return bookings.map(b=>({...b,recovery_transfers:transfers.filter(t=>String(t.booking_id)===String(b.id))}))
}
