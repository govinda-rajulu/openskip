// src/test-supabase.ts
import { supabase } from './lib/supabase.ts'

async function test() {
  const { data, error } = await supabase.from('playback_states').select('*').limit(1)
  console.log(data, error)
}

test()