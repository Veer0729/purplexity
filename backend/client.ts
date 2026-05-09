import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createClient() {
  return createSupabaseClient(
    process.env.BUN_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_API_SECRET!
    )
}
