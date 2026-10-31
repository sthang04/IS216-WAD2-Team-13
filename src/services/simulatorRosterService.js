/**
 * Read the simulator-specific, server-authorised roster through the shared
 * Supabase client. Tests inject a mock client; this module creates no client.
 * Membership does not establish role experience or timetable availability.
 */
export async function loadEventReplacementRosters(client, events) {
  const membershipsByKey = new Map()
  const byEvent = {}
  const membersById = new Map()
  const resolvedEvents = []
  const validId = value => /^(?:[1-9][0-9]*)$/.test(String(value)) &&
    (typeof value !== 'number' || Number.isSafeInteger(value))

  for (const event of events) {
    try {
      if (!validId(event.id)) throw new Error('Invalid event ID for replacement roster')
      const { data, error } = await client.rpc('rpc_simulator_event_roster', {
        p_event_id: event.id
      })
      // Fail visibly; do not use fixtures or treat a failed RPC as an empty roster.
      if (error) throw new Error('Could not load replacement roster: ' + error.message)
      if (!data || String(data.event_id) !== String(event.id) ||
          !validId(data.club_id) || !Array.isArray(data.members)) {
        throw new Error('Invalid replacement roster response')
      }
      // Validate the whole event response before committing any of its evidence.
      for (const row of data.members) {
        if (!validId(row.member_id) || String(row.club_id) !== String(data.club_id) ||
            typeof row.full_name !== 'string' || typeof row.academic_year !== 'string') {
          throw new Error('Invalid or unrelated membership in replacement roster')
        }
      }
      for (const row of data.members) {
        // Whitelist fields: even an unexpected response cannot merge contact or
        // authentication fields into the simulator's candidate data.
        membersById.set(String(row.member_id), { id: row.member_id, full_name: row.full_name })
        // Repeated events and duplicate server rows retain one item per year.
        // Different active years remain separate evidence; cards deduplicate by ID.
        const key = JSON.stringify([String(row.member_id), String(row.club_id), row.academic_year])
        membershipsByKey.set(key, { memberId: row.member_id, clubId: row.club_id,
          academicYear: row.academic_year, active: true, verified: true })
      }
      // club_id is normalized simulator data, not a new events database column.
      resolvedEvents.push({ ...event, club_id: data.club_id })
      byEvent[String(event.id)] = {
        rosterVerified: true, scheduleVerified: false,
        warning: 'Club roster loaded. Timetable coverage is incomplete: no recorded clash does not prove availability. Replacement candidates require manual availability review.'
      }
    } catch (error) {
      // Keep other events usable, but never hide this event's failed request.
      // Clear any untrusted club_id so failed events cannot borrow another roster.
      resolvedEvents.push({ ...event, club_id: null })
      byEvent[String(event.id)] = {
        rosterVerified: false, scheduleVerified: false,
        warning: 'Replacement roster unavailable for this event: ' + (error?.message || String(error))
      }
    }
  }
  return {
    events: resolvedEvents,
    members: [...membersById.values()],
    replacement_memberships: [...membershipsByKey.values()],
    member_replacement_coverage: {
      byEvent,
      rosterVerified: events.length > 0 && Object.values(byEvent).every(c => c.rosterVerified),
      scheduleVerified: false,
      warning: Object.values(byEvent).some(c => !c.rosterVerified)
        ? 'Some event rosters failed to load. Select an event to see its coverage warning.'
        : 'Club rosters loaded; timetable coverage remains incomplete.'
    }
  }
}
