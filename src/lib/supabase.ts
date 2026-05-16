import { createClient } from '@supabase/supabase-js'

// Replace these with your actual Supabase project credentials
const SUPABASE_URL = 'https://nvmnnvprxczqaxaitdng.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_zIPd0fQcG2cWGnRiW9PRKA_DhwvnMfS'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)