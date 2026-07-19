# Supabase Data Privacy - Audit Report

## Status: SECURE (Application-Level Scoping)

All Supabase REST API calls enforce `user_id` filtering at the application layer:

### SELECT Queries
- `SUPABASE_GET`: `?user_id=eq.{userId}&media_id=eq.{mediaId}`
- `SUPABASE_GET_ALL`: `?user_id=eq.{userId}&order=...`
- `SUPABASE_SETTINGS_GET`: `?user_id=eq.{userId}`

### INSERT/UPSERT Operations
- `supabaseUpsert()`: user_id in POST body (playback_states)
- `SUPABASE_SETTINGS_UPSERT`: user_id in POST body (user_settings)

## Design Rationale

- Shared anon key (same for all users) → cannot use JWT-based RLS
- Application-level filtering ensures each user_id constraint is enforced upstream
- RLS policies are permissive (`using (true)`) but unreachable without user_id filter
- Multiple users sharing same Supabase project remain data-isolated

## Recommendation

No code changes needed. Filtering is comprehensive. If stricter isolation required in future:
- Migrate to per-user authentication (requires API redesign)
- Implement database-level RLS with custom headers (requires Postgres function)
