// Reads an .ics calendar file (SMU timetable export, Google Calendar, Outlook)
// into simple events, so the meeting scheduler can show your classes as busy.
// The parsed events are saved to Supabase (rpc_save_my_baseline) as your timetable.
// Handles one-off events and weekly / daily repeats (RRULE with BYDAY, INTERVAL,
// UNTIL, COUNT, plus EXDATE). All-day events are skipped: they don't block hours.
// Times with a TZID are read as local time (fine for Singapore, which has no DST).

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const DAY_MS = 24 * 60 * 60 * 1000

function pad(n) { return String(n).padStart(2, '0') }
function dateKey(dt) { return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` }
function startOfDay(dt) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) }
function mondayOf(dt) { const d = startOfDay(dt); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d }

// 20260810T120000 (local), 20260810T040000Z (UTC) or 20260810 (all-day)
function parseIcsDate(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h = '0', mi = '0', s = '0', utc] = m
  if (utc) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
  return new Date(+y, +mo - 1, +d, +h, +mi, +s)
}

// FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;UNTIL=20261121T155959Z
function parseRrule(value) {
  const parts = Object.fromEntries(value.split(';').map((p) => p.split('=')))
  const until = parts.UNTIL ? parseIcsDate(parts.UNTIL) : null
  return {
    freq: parts.FREQ,
    interval: parseInt(parts.INTERVAL || '1', 10),
    byday: parts.BYDAY ? parts.BYDAY.split(',').map((c) => DAY_CODES.indexOf(c.slice(-2))).filter((i) => i >= 0) : [],
    until: until ? until.getTime() : null,
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : null
  }
}

function unescapeText(value) {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

// Returns [{ title, start, end, rrule, exdates }] with start/end as ms timestamps
export function parseIcs(text) {
  // Long lines are folded onto the next line, which starts with a space or tab
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const events = []
  let current = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = { title: 'Busy', exdates: [] }; continue }
    if (line === 'END:VEVENT') {
      if (current && current.start && !current.allDay) {
        const start = current.start.getTime()
        const end = current.end ? current.end.getTime() : start + 60 * 60 * 1000
        events.push({ title: current.title, start, end, rrule: current.rrule || null, exdates: current.exdates })
      }
      current = null
      continue
    }
    if (!current) continue

    const colon = line.indexOf(':')
    if (colon < 0) continue
    const [name, ...params] = line.slice(0, colon).split(';')
    const value = line.slice(colon + 1).trim()

    if (name === 'SUMMARY') current.title = unescapeText(value) || 'Busy'
    else if (name === 'DTSTART') {
      current.start = parseIcsDate(value)
      current.allDay = params.includes('VALUE=DATE') || /^\d{8}$/.test(value)
    }
    else if (name === 'DTEND') current.end = parseIcsDate(value)
    else if (name === 'RRULE') current.rrule = parseRrule(value)
    else if (name === 'EXDATE') {
      value.split(',').map(parseIcsDate).filter(Boolean).forEach((dt) => current.exdates.push(dateKey(dt)))
    }
  }
  return events
}

// Does this event happen on this calendar day?
function occursOn(ev, day) {
  const first = startOfDay(new Date(ev.start))
  if (day < first) return false
  if (ev.exdates.includes(dateKey(day))) return false

  const r = ev.rrule
  if (!r) return day.getTime() === first.getTime()
  if (r.until && day.getTime() > r.until) return false

  const matches = (dt) => {
    const days = Math.round((dt - first) / DAY_MS)
    if (r.freq === 'DAILY') return days % r.interval === 0
    if (r.freq === 'WEEKLY') {
      const weekdays = r.byday.length ? r.byday : [first.getDay()]
      const weeks = Math.round((mondayOf(dt) - mondayOf(first)) / (7 * DAY_MS))
      return weekdays.includes(dt.getDay()) && weeks % r.interval === 0
    }
    return days === 0 // monthly / yearly repeats: only the first one
  }
  if (!matches(day)) return false

  // COUNT: this must be one of the first N occurrences
  if (r.count) {
    let n = 0
    for (let dt = first; dt <= day; dt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1)) {
      if (matches(dt)) n++
      if (n > r.count) return false
    }
  }
  return true
}

// Everything on this day, in time order: [{ title, startTime: '15:30', endTime: '17:00' }]
// (used by Personal Schedule to list your classes)
export function icsEventsOn(events, day) {
  const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`
  return events
    .filter((ev) => !ev.allDay && occursOn(ev, day))
    .map((ev) => {
      const s = new Date(ev.start)
      const startMin = s.getHours() * 60 + s.getMinutes()
      return { title: ev.title, startMin, startTime: hhmm(startMin), endTime: hhmm(startMin + Math.round((ev.end - ev.start) / 60000)) }
    })
    .sort((a, b) => a.startMin - b.startMin)
}

// Title of the first event that overlaps hour..hour+1 on this day, or ''
export function icsEventAt(events, day, hour) {
  for (const ev of events) {
    if (!occursOn(ev, day)) continue
    const s = new Date(ev.start)
    const startMin = s.getHours() * 60 + s.getMinutes()
    const endMin = startMin + (ev.end - ev.start) / 60000
    if (startMin < (hour + 1) * 60 && endMin > hour * 60) return ev.title
  }
  return ''
}
