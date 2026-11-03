// Bounds come from the already loaded event, never a fallback date.
// Singapore wall time is independent of the browser's timezone and DST.
export function singaporeLocal(value) {
 const ms = Date.parse(value)
 if (!Number.isFinite(ms)) return ''
 const local = new Date(ms + 8 * 3600000).toISOString().slice(0,-1)
 // Preserve nonzero seconds/milliseconds in authoritative schedules so a valid
 // default never rounds before the event start or beyond its end.
 return local.endsWith(':00.000') ? local.slice(0,16) : local.endsWith('.000') ? local.slice(0,19) : local
}
export function scheduleRange(record) {
 const parse = value => typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN
 const start = parse(record?.starts_at), end = parse(record?.ends_at)
 return Number.isFinite(start) && Number.isFinite(end) && start < end ? {start,end} : null
}
export function requireEventRange(event) {
 const range = scheduleRange(event)
 if (!range) throw new Error('This event has a missing or invalid schedule. Verify its start and end before simulating.')
 return range
}
export function requireActivityRange(eventRange, segment) {
 const range = scheduleRange(segment)
 if (!range || range.start < eventRange.start || range.end > eventRange.end)
  throw new Error('The selected activity has a missing, invalid or out-of-event schedule.')
 return range
}
// Enumerate Singapore calendar days across midnight/multiple days. UTC arithmetic
// operates on wall dates here, so host timezone transitions cannot skip a date.
export function eventDates(event) {
 if (!scheduleRange(event)) return []
 const first = singaporeLocal(event.starts_at).slice(0,10)
 const last = singaporeLocal(event.ends_at).slice(0,10)
 const dates = []
 for (let day = Date.parse(first+'T00:00:00Z'); day <= Date.parse(last+'T00:00:00Z'); day += 86400000)
  dates.push(new Date(day).toISOString().slice(0,10))
 return dates
}

// One-minute choices keep normal times available; exact boundaries and an existing
// precise value are added separately so picker presentation never rounds timestamps.
export function disruptionTimeOptions(event, date, current = '') {
 const range = scheduleRange(event)
 if (!range || !eventDates(event).includes(date)) return []
 const midnight = Date.parse(date + 'T00:00:00+08:00')
 const lower = Math.max(range.start, midnight)
 const upper = Math.min(range.end, midnight + 86400000 - 1)
 const values = new Set()
 for (let ms = Math.ceil(lower / 60000) * 60000; ms <= upper; ms += 60000)
  values.add(singaporeLocal(new Date(ms).toISOString()))
 for (const ms of [range.start, range.end, Date.parse(current + '+08:00')]) {
  if (ms >= lower && ms <= upper) values.add(singaporeLocal(new Date(ms).toISOString()))
 }
 return [...values].sort()
}
export function formatPickerTime(value) {
 const time = value.split('T')[1] || ''
 const [hour, ...rest] = time.split(':')
 return (Number(hour) % 12 || 12) + ':' + rest.join(':') + (Number(hour) < 12 ? ' AM' : ' PM')
}
