import { createClient } from '@supabase/supabase-js'

const rawURL = import.meta.env.VITE_SUPABASE_URL || '' 
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

const supabaseUrl = rawURL.trim()
const supabaseAnonKey = rawKey.trim()

// Helper function to check a Supabase configured credentials
export const isSupabaseConfigured = () => {
    return (
        supabaseUrl.startsWith('https://') && !supabaseUrl.includes('your-supabase-url') &&  !supabaseUrl.includes('your-project-id') && supabaseAnonKey.length >30 && supabaseAnonKey !== 'your-anon-key'
    )
}

let client = null
if (isSupabaseConfigured()) {
    try {
        client = createClient(supabaseUrl, supabaseAnonKey)
    } catch (err) {
        console.warn('Failed to initialize Supabase client:', err.message)
    }
}


// create and export supabase (a single client, so only one instance manages the login session)
export const supabase = client;