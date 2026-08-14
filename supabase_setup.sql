-- SkipStream - Supabase Setup
-- Run once in your Supabase project: SQL Editor > New query > paste > Run.
-- Every statement is fully idempotent: safe to re-run without data loss.
-- Version: 2.0 (2026-06)

-- ── 1. playback_states table ──────────────────────────────────────────────────
create table if not exists public.playback_states (
  id            bigserial    primary key,
  user_id       text         not null,
  media_id      text         not null,
  playback_time integer      not null default 0,
  duration      integer,
  site          text,
  site_name     text,
  video_title   text,
  device_name   text,
  page_url      text,
  updated_at    timestamptz  not null default now(),
  constraint playback_states_user_media_key unique (user_id, media_id)
);

-- ── 2. Add columns to existing installs (idempotent) ─────────────────────────
do $$ begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='playback_states' and column_name='site_name') then
    alter table public.playback_states add column site_name text;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='playback_states' and column_name='video_title') then
    alter table public.playback_states add column video_title text;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='playback_states' and column_name='device_name') then
    alter table public.playback_states add column device_name text;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='playback_states' and column_name='page_url') then
    alter table public.playback_states add column page_url text;
  end if;
end $$;

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
create index if not exists playback_states_user_id_idx
  on public.playback_states (user_id);
create index if not exists playback_states_updated_at_idx
  on public.playback_states (updated_at desc);

-- ── 4. Row-level security ─────────────────────────────────────────────────────
alter table public.playback_states enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='playback_states' and policyname='ss_anon_select') then
    execute 'create policy ss_anon_select on public.playback_states for select using (true)';
  end if;
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='playback_states' and policyname='ss_anon_insert') then
    execute 'create policy ss_anon_insert on public.playback_states for insert with check (true)';
  end if;
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='playback_states' and policyname='ss_anon_update') then
    execute 'create policy ss_anon_update on public.playback_states for update using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='playback_states' and policyname='ss_anon_delete') then
    execute 'create policy ss_anon_delete on public.playback_states for delete using (true)';
  end if;
end $$;

-- ── 5. Auto-update updated_at trigger ────────────────────────────────────────
create or replace function public.ss_set_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger
    where tgname='ss_playback_states_updated_at'
      and tgrelid='public.playback_states'::regclass) then
    create trigger ss_playback_states_updated_at
      before update on public.playback_states
      for each row execute function public.ss_set_updated_at();
  end if;
end $$;

-- ── 6. Drop legacy upsert rule (conflicts with REST ON CONFLICT syntax) ───────
drop rule if exists playback_states_upsert on public.playback_states;

-- ── 7. user_settings table ────────────────────────────────────────────────────
-- Stores stats, preferences, site rules, theme, and credentials per user.
-- Synced automatically; restores settings on new installs.
create table if not exists public.user_settings (
  user_id     text         primary key,
  stats       jsonb        not null default '{}',
  prefs       jsonb        not null default '{}',
  site_rules  jsonb        not null default '{}',
  theme       text,
  creds       jsonb        not null default '{}',
  updated_at  timestamptz  not null default now()
);

alter table public.user_settings enable row level security;

do $$ begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='user_settings' and column_name='creds') then
    alter table public.user_settings add column creds jsonb not null default '{}';
  end if;
end $$;

-- Drop legacy settings policies from older installs to enforce the zero-policy model.
drop policy if exists ss_settings_select on public.user_settings;
drop policy if exists ss_settings_insert on public.user_settings;
drop policy if exists ss_settings_update on public.user_settings;
drop policy if exists ss_settings_delete on public.user_settings;

revoke all on table public.user_settings from anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger
    where tgname='ss_user_settings_updated_at'
      and tgrelid='public.user_settings'::regclass) then
    create trigger ss_user_settings_updated_at
      before update on public.user_settings
      for each row execute function public.ss_set_updated_at();
  end if;
end $$;

-- ── 8. Table grants (must run after both tables exist) ───────────────────────
grant select, insert, update, delete on public.playback_states to anon, authenticated;
grant usage on all sequences in schema public to anon, authenticated;

-- ── 8b. Settings RPCs (security definer) ─────────────────────────────────────
create or replace function public.ss_get_settings(p_user_id text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'user_id', u.user_id,
        'stats', u.stats,
        'prefs', u.prefs,
        'site_rules', u.site_rules,
        'theme', u.theme,
        'updated_at', u.updated_at
      )
      from public.user_settings u
      where u.user_id = p_user_id
    ),
    '{}'::jsonb
  );
$$;

create or replace function public.ss_put_settings(
  p_user_id text, p_stats jsonb, p_prefs jsonb, p_site_rules jsonb, p_theme text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_settings (user_id, stats, prefs, site_rules, theme, creds)
  values (
    p_user_id,
    coalesce(p_stats, '{}'::jsonb),
    coalesce(p_prefs, '{}'::jsonb),
    coalesce(p_site_rules, '{}'::jsonb),
    p_theme,
    '{}'::jsonb
  )
  on conflict (user_id) do update set
    stats = excluded.stats,
    prefs = excluded.prefs,
    site_rules = excluded.site_rules,
    theme = excluded.theme,
    updated_at = now();
$$;

create or replace function public.ss_put_creds(p_user_id text, p_creds jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_settings (user_id, stats, prefs, site_rules, theme, creds)
  values (
    p_user_id,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    null,
    coalesce(p_creds, '{}'::jsonb)
  )
  on conflict (user_id) do update set
    creds = excluded.creds,
    updated_at = now();
$$;

revoke all on function public.ss_get_settings(text) from public;
revoke all on function public.ss_put_settings(text,jsonb,jsonb,jsonb,text) from public;
revoke all on function public.ss_put_creds(text,jsonb) from public;
grant execute on function public.ss_get_settings(text) to anon, authenticated;
grant execute on function public.ss_put_settings(text,jsonb,jsonb,jsonb,text) to anon, authenticated;
grant execute on function public.ss_put_creds(text,jsonb) to anon, authenticated;

-- ── 9. Setup verification function ───────────────────────────────────────────
-- Call select public.ss_verify_setup() after running this script to confirm.
create or replace function public.ss_verify_setup()
  returns jsonb language plpgsql as $$
declare
  result jsonb := '{}';
begin
  -- Check tables
  result := result || jsonb_build_object(
    'playback_states_exists',
    exists(select 1 from information_schema.tables
      where table_schema='public' and table_name='playback_states'),
    'user_settings_exists',
    exists(select 1 from information_schema.tables
      where table_schema='public' and table_name='user_settings'),
    'user_settings_creds_column',
    exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='user_settings' and column_name='creds')
  );
  -- Check RLS enabled
  result := result || jsonb_build_object(
    'playback_states_rls',
    (select relrowsecurity from pg_class
      where relname='playback_states' and relnamespace='public'::regnamespace),
    'user_settings_rls',
    (select relrowsecurity from pg_class
      where relname='user_settings' and relnamespace='public'::regnamespace),
    'user_settings_direct_access_revoked',
    not exists (
      select 1 from information_schema.role_table_grants
      where table_schema='public'
        and table_name='user_settings'
        and grantee in ('anon','authenticated')
        and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
    )
  );
  -- Check policy counts and RPCs
  result := result || jsonb_build_object(
    'playback_states_policies',
    (select count(*) from pg_policies
      where schemaname='public' and tablename='playback_states'),
    'user_settings_policies',
    (select count(*) from pg_policies
      where schemaname='public' and tablename='user_settings'),
    'rpc_ss_get_settings',
    exists(select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='ss_get_settings'),
    'rpc_ss_put_settings',
    exists(select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='ss_put_settings'),
    'rpc_ss_put_creds',
    exists(select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='ss_put_creds')
  );
  -- Check triggers
  result := result || jsonb_build_object(
    'triggers_ok',
    (select count(*) from pg_trigger
      where tgname in ('ss_playback_states_updated_at','ss_user_settings_updated_at')) = 2
  );
  return result || jsonb_build_object(
    'setup_complete',
    (
      exists(select 1 from information_schema.tables where table_schema='public' and table_name='playback_states')
      and exists(select 1 from information_schema.tables where table_schema='public' and table_name='user_settings')
      and (select count(*) from pg_policies where schemaname='public' and tablename='user_settings') = 0
      and exists(select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='ss_get_settings')
      and exists(select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='ss_put_settings')
      and exists(select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='ss_put_creds')
      and not exists (
        select 1 from information_schema.role_table_grants
        where table_schema='public'
          and table_name='user_settings'
          and grantee in ('anon','authenticated')
          and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
      )
    )
  );
end;
$$;

-- Run verification automatically
select public.ss_verify_setup();
