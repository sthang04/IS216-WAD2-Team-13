
/*
=========================================================
TEMPORARY TEST — REPLACEMENT RECOMMENDATIONS
=========================================================

PURPOSE:
Find out why the replacement recommendation algorithm
returns no eligible candidates.

This test checks:
1. Whether Supabase members are loaded.
2. Which roles each member has performed.
3. Whether the unavailable member has affected assignments.
4. Whether the recommendation algorithm returns candidates.

IMPORTANT:
- Read-only testing.
- Does not change Supabase records.
- Does not modify the recommendation algorithm.
- Delete this file after debugging.
=========================================================
*/

import {
  loadSimulationData
} from '../services/simulationDataService.js'

import {
  recommendMemberReplacements
} from '../services/recoveryRecommendationService.js'

export async function testReplacementRecommendations() {

  console.log('================================')
  console.log('REPLACEMENT RECOMMENDATION TEST')
  console.log('================================')

  try {

    // STEP 1: Load actual Supabase records.
    const data = await loadSimulationData({
      source: 'supabase'
    })

    console.log('DATA LOADED:', {
      events: data.events?.length,
      members: data.members?.length,
      assignments: data.segment_assignments?.length,
      segments: data.event_segments?.length
    })

    // STEP 2: Select the first accessible event.
    const event = data.events?.[0]

    if (!event) {
      console.warn('No event found.')
      return
    }

    const segments = data.event_segments.filter(
      segment => segment.event_id === event.id
    )

    const segmentIds = new Set(
      segments.map(segment => segment.id)
    )

    const assignments = data.segment_assignments.filter(
      assignment => segmentIds.has(assignment.segment_id)
    )

    console.log('SELECTED EVENT:', event.name)

    // STEP 3: Display members and their recorded roles.
    const memberRoles = data.members.map(member => {

      const roles = [
        ...new Set(
          data.segment_assignments
            .filter(assignment =>
              assignment.member_id === member.id
            )
            .map(assignment => assignment.role_name)
            .filter(Boolean)
        )
      ]

      return {
        member: member.full_name,
        memberId: member.id,
        roles: roles.join(', ') || 'No recorded role',
        assignmentCount: assignments.filter(
          assignment =>
            assignment.member_id === member.id
        ).length
      }
    })

    console.table(memberRoles)
    console.log(
        'MEMBER ROLE DETAILS:',
        JSON.stringify(memberRoles, null, 2)
        )

    // STEP 4: Choose an assigned member to simulate.
    const assignment = assignments[0]

    if (!assignment) {
      console.warn(
        'No assignments exist for this event.'
      )
      return
    }

    const unavailableMemberId = assignment.member_id

    const affectedSegment = segments.find(
      segment => segment.id === assignment.segment_id
    )

    if (!affectedSegment) {
      console.warn('Assigned segment not found.')
      return
    }

    // STEP 5: Create a disruption overlapping
    // the member's assigned activity.
    const disruptions = [{
      id: 'debug-member-unavailable',
      type: 'MEMBER_UNAVAILABLE',
      memberId: unavailableMemberId,
      start: affectedSegment.starts_at,
      end: affectedSegment.ends_at
    }]

    console.log('TEST DISRUPTION:', disruptions[0])

    // STEP 6: Run the actual recommendation algorithm.
    const candidates = recommendMemberReplacements(
      data,
      event.id,
      unavailableMemberId,
      disruptions
    )

    console.log('ELIGIBLE CANDIDATES:', candidates)
    
/*
=========================================================
DEBUG: WHY WAS EACH REPLACEMENT CANDIDATE REJECTED?
=========================================================
*/

const requiredRole = String(
  assignment.role_name || ''
).trim().toLowerCase()

const requiredStart = Date.parse(
  affectedSegment.starts_at
)

const requiredEnd = Date.parse(
  affectedSegment.ends_at
)

const segmentById = new Map(
  data.event_segments.map(segment => [
    segment.id,
    segment
  ])
)

const candidateDiagnostics = data.members
  .filter(member =>
    member.id !== unavailableMemberId
  )
  .map(member => {

    // Retrieve this candidate's assignments.
    const memberAssignments =
      data.segment_assignments.filter(
        item => item.member_id === member.id
      )

    // Check for an exact recorded role match.
    const roles = memberAssignments.map(
      item =>
        String(item.role_name || '')
          .trim()
          .toLowerCase()
    )

    const roleMatch = roles.includes(requiredRole)

    // Check for overlapping assignments.
    // Ignore assignments to the affected activity itself.
    const clashes = memberAssignments.filter(item => {

      if (item.segment_id === affectedSegment.id) {
        return false
      }

      const segment = segmentById.get(
        item.segment_id
      )

      if (!segment) return false

      return (
        Date.parse(segment.starts_at) < requiredEnd &&
        requiredStart < Date.parse(segment.ends_at)
      )
    })

    // Explain why this candidate was excluded.
    const reasons = []

    if (!roleMatch) {
      reasons.push('No matching recorded role')
    }

    if (clashes.length > 0) {
      reasons.push(
        `${clashes.length} timetable clash(es)`
      )
    }

    return {
      member: member.full_name,
      recordedRoles: roles.join(', ') || 'None',
      requiredRole,
      roleMatch,
      timetableClashes: clashes.length,
      status: reasons.length
        ? 'REJECTED'
        : 'POTENTIALLY ELIGIBLE',
      reason: reasons.join('; ') || 'Passed basic checks'
    }
  })

console.log('CANDIDATE REJECTION DIAGNOSTICS')
console.table(candidateDiagnostics)


    if (candidates.length === 0) {
      console.warn(
        'No eligible candidates returned.'
      )

      console.log(
        'Possible causes:',
        [
          'No matching recorded role',
          'Candidates have timetable clashes',
          'Members without assignments were not loaded'
        ]
      )
    } else {
      console.table(candidates)
    }

    console.log('TEST COMPLETE')

    return {
      event,
      memberRoles,
      candidates
    }

  } catch (error) {
    console.error(
      'TEST FAILED:',
      error
    )

    throw error
  }
}
