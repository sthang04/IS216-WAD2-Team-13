import { supabase, isSupabaseConfigured }  from "../supabase"

// Sample records: venues follow the ACF booking sheet (locations and types are provisional).
const DEFAULT_SLOTS = [
    {
        id: 1,
        venue_name: "ACC",
        venue_type: "Multi-Purpose",
        building_location: "Location TBC",
        event_date: "2027-10-16",
        time_slot: "10:00 - 13:00",
        owner_club: "Stageit",
        status: "Booked",
        claiming_club: null,
        audit_ticket_id: null,
        notes: null,
    },
    {
        id: 2,
        venue_name: "Studio L7.1 (Music)",
        venue_type: "Acoustic Room",
        building_location: "Level 7",
        event_date: "2027-10-16",
        time_slot: "16:00 - 19:00",
        owner_club: "Chinese Orchestra",
        status: "Proposed Peer Transfer",
        claiming_club: null,
        audit_ticket_id: null,
        notes: null,
    },
    {
        id: 3,
        venue_name: "Studio L7.2 (Dance)",
        venue_type: "Dance Studio",
        building_location: "Level 7",
        event_date: "2027-10-16",
        time_slot: "18:00 - 21:00",
        owner_club: "Eurhythmix",
        status: "Booked",
        claiming_club: null,
        audit_ticket_id: null,
        notes: null,
    },
    {
        id: 4,
        venue_name: "Gym Studio",
        venue_type: "Sports Court",
        building_location: "Location TBC",
        event_date: "2027-10-17",
        time_slot: "19:00 - 22:00",
        owner_club: "ACF ExCo",
        status: "Booked",
        claiming_club: null,
        audit_ticket_id: null,
        notes: null,
    },
    {
        id: 5,
        venue_name: "Music Drama Lab (MDL)",
        venue_type: "Acoustic Room",
        building_location: "Location TBC",
        event_date: "2027-10-17",
        time_slot: "14:00 - 18:00",
        owner_club: "SoundFoundry",
        status: "Pending Admin Sign-off",
        claiming_club: "Eurhythmix",
        audit_ticket_id: "#SMU-2027-089",
        notes: null,
    },
    {
        id: 6,
        venue_name: "Basement Studio",
        venue_type: "Multi-Purpose",
        building_location: "Basement",
        event_date: "2027-10-18",
        time_slot: "15:00 - 18:00",
        owner_club: "Funk Movement",
        status: "Booked",
        claiming_club: null,
        audit_ticket_id: null,
        notes: null,
    },
]

// In-memory reactive cache for fallback mode
let localCache = JSON.parse(JSON.stringify(DEFAULT_SLOTS))

// one small helper to read the actual record and validate transitions.
async function findSlot(id) {
    if (isSupabaseConfigured() && supabase) {
        const { data, error } = await supabase.from('facility_slots').select('*').eq('id', id).single()
        if (error) throw error
        return data
    }
    return localCache.find((s) => s.id === id)
}

export const facilityService = {
    // Fetch all facility slots live from Supabase or local fallback
    async getSlots() {
        if (isSupabaseConfigured() && supabase) {
            try {
                const {data, error} = await supabase.from('facility_slots').select('*').order('id', { ascending: true })
                if (error) throw error
                return {data: data || [], source: 'supabase'}
            } catch (err) {
                console.warn('Supabase fetch failed, falling back to local seed data:', err.message)
            }
        }
        return {data: JSON.parse(JSON.stringify(localCache)), source: 'local'}
    },

    // Release owned booking into Campus Marketplace for peer transfer
    async releaseSlot(id, actingClub) {
        // ADDED: verify this is the acting club's own BOOKED slot.
        const current = await findSlot(id)
        if (!current || (current.status !== 'Booked' && current.status !== 'Officially Confirmed') || current.owner_club !== actingClub) {
            throw new Error('Only the owner club can release its booked facility.')
        }
        const updates = {
            status: "Proposed Peer Transfer",
            claiming_club: null,
            audit_ticket_id: null,
            updated_at: new Date().toISOString()
        }

        if (isSupabaseConfigured() && supabase) {
            const {data, error} = await supabase.from('facility_slots').update(updates)
                .eq('id', id).in('status', ['Booked', 'Officially Confirmed']).eq('owner_club', actingClub).select()
            if (error) throw error
            if (!data?.length) throw new Error('The booking has changed; please refresh.')
            return {success: true, data: data[0], source: 'supabase'}
        }

        // Local fallback update
        const slot = localCache.find((s) => s.id === id)
        if (slot) Object.assign(slot, updates)
        return {success: true, data: slot, source: 'local'}
    },

    // Claim a released slot from another club (goes into Pending Admin Sign-off)
    async claimSlot(id, claimingClub) {
        // ADDED: a club cannot claim its own booking or an unavailable slot.
        const current = await findSlot(id)
        if (!current || current.status !== 'Proposed Peer Transfer' ||
            current.claiming_club || current.owner_club === claimingClub || !claimingClub) {
            throw new Error('This facility cannot be claimed by the selected club.')
        }
        const updates = {
            status: "Pending Admin Sign-off",
            claiming_club: claimingClub,
            audit_ticket_id: `#SMU-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
            updated_at: new Date().toISOString()
        }

        if (isSupabaseConfigured() && supabase) {
            const {data, error} = await supabase.from('facility_slots').update(updates)
                .eq('id', id).eq('status', 'Proposed Peer Transfer').is('claiming_club', null).select()
            if (error) throw error
            if (!data?.length) throw new Error('The booking has changed; please refresh.')
            return {success: true, data: data[0], source: 'supabase'}
        }

        // Local fallback update
        const slot = localCache.find((s) => s.id === id)
        if (slot) Object.assign(slot, updates)
        return {success: true, data: slot, source: 'local'}
    },

    // Admin confirms the transfer: stay within the 3 agreed statuses.
    async confirmPeerTransfer(id) {
        // CHANGED: use the real claiming club, NOT the local sample cache.
        const slotTarget = await findSlot(id)
        if (!slotTarget || slotTarget.status !== 'Pending Admin Sign-off' || !slotTarget.claiming_club) {
            throw new Error('No valid pending claim to confirm.')
        }
        const newOwner = slotTarget.claiming_club

        const updates = {
            status: "Officially Confirmed",  // CHANGED: no fourth status
            owner_club: newOwner,
            claiming_club: null,
            audit_ticket_id: null,
            updated_at: new Date().toISOString()
        }

        if (isSupabaseConfigured() && supabase) {
            const {data, error} = await supabase.from('facility_slots').update(updates)
                .eq('id', id).eq('status', 'Pending Admin Sign-off')
                .eq('claiming_club', newOwner).select()
            if (error) throw error
            if (!data?.length) throw new Error('The claim has changed; please refresh.')
            return {success: true, data: data[0], source: 'supabase'}
        }

        // Local fallback update
        if (slotTarget) Object.assign(slotTarget, updates)
        return {success: true, data: slotTarget, source: 'local'}
    },

    // ADDED: Owner can restore an unclaimed release.
    async undoRelease(id, actingClub) {
        const slot = await findSlot(id)
        if (!slot || slot.status !== 'Proposed Peer Transfer' || slot.claiming_club || slot.owner_club !== actingClub) {
            throw new Error('Only the owner may undo an unclaimed release.')
        }
        const updates = { status: 'Booked', updated_at: new Date().toISOString() }
        if (isSupabaseConfigured() && supabase) {
            const {data, error} = await supabase.from('facility_slots').update(updates)
                .eq('id', id).eq('owner_club', actingClub)
                .eq('status', 'Proposed Peer Transfer').is('claiming_club', null).select()
            if (error) throw error
            if (!data?.length) throw new Error('This slot has changed; please refresh.')
            return { success: true, data: data[0], source: 'supabase' }
        }
        Object.assign(slot, updates)
        return { success: true, data: slot, source: 'local' }
    },

    // ADDED: Admin rejects a claim; release remains available to other clubs.
    async rejectPeerTransfer(id) {
        const slot = await findSlot(id)
        if (!slot || slot.status !== 'Pending Admin Sign-off' || !slot.claiming_club) {
            throw new Error('No pending claim to reject.')
        }
        const updates = {
            status: 'Proposed Peer Transfer', claiming_club: null,
            audit_ticket_id: null, updated_at: new Date().toISOString()
        }
        if (isSupabaseConfigured() && supabase) {
            const {data, error} = await supabase.from('facility_slots').update(updates)
                .eq('id', id).eq('status', 'Pending Admin Sign-off')
                .eq('claiming_club', slot.claiming_club).select()
            if (error) throw error
            if (!data?.length) throw new Error('This claim has changed; please refresh.')
            return { success: true, data: data[0], source: 'supabase' }
        }
        Object.assign(slot, updates)
        return { success: true, data: slot, source: 'local' }
    },

    // Reset data back to initial seeds
    async resetData() {
        if (isSupabaseConfigured() && supabase) {
            for (const slot of DEFAULT_SLOTS) {
                const {error} = await supabase.from('facility_slots').update({
                    status: slot.status, owner_club: slot.owner_club,
                    claiming_club: slot.claiming_club, audit_ticket_id: slot.audit_ticket_id
                }).eq('id', slot.id)
                if (error) throw error
            }
        }
        // CHANGED: restore local cache too.
        localCache = JSON.parse(JSON.stringify(DEFAULT_SLOTS))
        return {success: true}
    }
}

// Status badge styling helper 

export function getStatusBadgeClass(status) {
   switch(status) {
    case 'Proposed Peer Transfer': return 'badge bg-warning text-dark'
    case 'Pending Admin Sign-off': return 'badge bg-info text-dark'
    case 'Officially Confirmed': return 'badge bg-success'
    case 'Booked':
    default: 
      return 'badge bg-secondary'
   } 
}

