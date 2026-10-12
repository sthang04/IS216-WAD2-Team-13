import { supabase, isSupabaseConfigured }  from "../supabase"

// need to check the venue names if same as smu venues, for now i put randomly pls help tq

const DEFAULT_SLOTS = [
    {
        id: 1,
        venue_name: "Dance Studio A",
        venue_type: "Dance Studio",
        building_location: "School Of Econonomics, Level 7, Room 201",
        event_date: "2027-10-16",
        time_slot: "18:00 - 21:00",
        owner_club: "SMU Eurhythmix",
        status: "Booked",
        claiming_club: null,
        audit_ticket_id: null,
        notes: "Mirrored walls, sprung floor, and sound system available. Please ensure to clean up after use.",
        
    },
    
    {
        id: 2,
        venue_name: "Band Room B",
        venue_type: "Acoustic Room",
        building_location: "School Of Econonomics, Level B1",
        event_date: "2027-10-16",
        time_slot: "16:00 - 19:00",
        owner_club: "SMU Chamber Orchestra",
        status: "Proposed Peer Transfer",
        claiming_club: null,
        audit_ticket_id: null,
        notes: "Acoustic treated, upright piano, 18 music stands"
        
    },

    {
        id: 3,
        venue_name: "Green Room",
        venue_type: "Acoustic Room",
        building_location: "SMU Hall, Basement",
        event_date: "2027-10-17",
        time_slot: "14:00 - 18:00",
        owner_club: "SoundFoundry",
        status: "Pending Admin Sign-off",
        claiming_club: "SMU Eurhythmix",
        audit_ticket_id: "#SMU-2027-089",
        notes: "Backstage holding room with 12 pax capacity"
        
    },

    {
        id: 4,
        venue_name: "Multi-Purpose Spo rtsHall",
        venue_type: "Sports Court",
        building_location: "Campus Centre, Level 2",
        event_date: "2027-10-17",
        time_slot: "19:00 - 22:00",
        owner_club: "ACF ExCo",
        status: "Booked",
        claiming_club: null,
        audit_ticket_id: null,
        notes: "50 pax capacity, parquet flooring, full PA system"
        
    },


]


// In-memory reactive cache for fallback mode

let localCache = JSON.parse(JSON.stringify(DEFAULT_SLOTS))

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

    async releaseSlot(id) {
        const updates = {
            status: "Proposed Peer Transfer",
            claiming_club: null,
            audit_ticket_id: null,
            updated_at: new Date().toISOString()        
        }
        
        if (isSupabaseConfigured() && supabase) {
            try {
                const {data, error} = await supabase.from('facility_slots').update(updates).eq('id', id).select()
                if (error) throw error
                return {success: true, data: data?.[0], source: 'supabase'}
            } catch (err) {
                console.warn('Supabase update failed, updating local state:', err.message)
            }
        }
        
        // Local fallback update
        const slot = localCache.find((s) => s.id === id)
        if (slot) Object.assign(slot, updates)
        return {success: true, data: slot, source: 'local'}
    },


    // Claim a released slot from another club (goes into Stage 1 [Pending Admin Sign-off])

    async claimSlot(id, claimingClub) {
        const updates = {
            status: "Pending Admin Sign-off",
            claiming_club: claimingClub,
            audit_ticket_id: `#SMU-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
            updated_at: new Date().toISOString()
        }

        if (isSupabaseConfigured() && supabase) {
            try {
                const {data, error} = await supabase.from('facility_slots').update(updates).eq('id', id).select()
                if (error) throw error
                return {success: true, data: data?.[0], source: 'supabase'}
            } catch (err) {
                console.warn('Supabase update failed, updating local state:', err.message)
            }
        }

        // Local fallback update
        const slot = localCache.find((s) => s.id === id)
        if (slot) Object.assign(slot, updates)
        return {success: true, data: slot, source: 'local'}
    
    },

    // Admin or Logs lead confirmes the peer transfer (goes into Stage 2 [Officially Confirmed])

    async confirmPeerTransfer(id) {
        const slotTarget =localCache.find((s) => s.id === id)
        const newOwner = slotTarget.claiming_club  || 'SMU Eurhythmix'

        const updates = {
            status: "Officially Confirmed",
            owner_club: newOwner,
            claiming_club: null,
            audit_ticket_id: null,
            updated_at: new Date().toISOString()
        }

        if (isSupabaseConfigured() && supabase) {
            try {
                const {data, error} = await supabase.from('facility_slots').update(updates).eq('id', id).select()
                if (error) throw error
                return {success: true, data: data?.[0], source: 'supabase'}
            } catch (err) {
                console.warn('Supabase update failed, updating local state:', err.message)
            }
        }   


        // Local fallback update
        if (slotTarget) Object.assign(slotTarget, updates)
        return {success: true, data: slotTarget, source: 'local'}
    },

        // reset data back to initial seeds

        async resetData() {
            if (isSupabaseConfigured() && supabase) {
                try {
                    for (const slot of DEFAULT_SLOTS) {
                        await supabase.from('facility_slots').update({status: slot.status, owner_club: slot.owner_club, claiming_club: slot.claiming_club, audit_ticket_id: slot.audit_ticket_id})
                        .eq('id', slot.id)
                    }
                } catch (err) {
                    console.warn('Supabase reset failed, resetting local state:', err.message)
                }
            }

            return{success: true}

        }

    }