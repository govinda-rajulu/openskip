# Supabase Data Privacy - Audit Report

Last verified: 15 August 2026

## user_settings: SECURE

Definer-only. The table has zero RLS policies and no grants to `anon` or
`authenticated`, so the publishable key cannot read or write it directly.
All access goes through security-definer functions scoped by user id:

- `ss_get_settings(text)` - stats, prefs, site rules, theme. Never returns credentials.
- `ss_put_settings(text,jsonb,jsonb,jsonb,text)` - writes settings, never touches credentials.
- `ss_put_creds(text,jsonb)` / `ss_get_creds(text)` - credential restore for a new install.

Verified by `information_schema.role_table_grants` returning no anon or
authenticated rows, and `pg_policies` returning none for the table.

## playback_states: MIGRATION IN PROGRESS

Definer functions exist and the client uses them exclusively:
`ss_put_playback`, `ss_get_playback`, `ss_get_playback_all`,
`ss_prune_playback`, `ss_clear_playback`.

**The permissive policies and grants are still in place**, so a holder of the
publishable key can still read and rewrite the whole table by calling REST
directly. That is closed by dropping the four `ss_anon_*` policies and revoking
the table grants, which is safe only after the client change above is verified
on a device.

Note: `REVOKE` only removes grants made by the current grantor, so a revoke can
silently succeed while leaving grants live. Always confirm with
`information_schema.role_table_grants` rather than trusting the statement.

## What is never sent anywhere

API keys live in `browser.storage.local` and are excluded from backup exports by
an explicit deny list. Statistics are local only. There is no telemetry, which is
also a store requirement: the listing declares `data_collection_permissions: none`.

## Identity

Each install generates a random UUID v4, persisted locally. It is deliberately
not derived from the publishable key: a derived id would let anyone holding that
key compute every row id and enumerate all history.

## How to verify

Run `select public.ss_verify_setup();` in the Supabase SQL editor. It reports
table existence, RLS state, policy counts, whether direct access is revoked, and
which RPCs exist.
