-- SkipStream - Supabase Setup
-- Run this once in your Supabase project → SQL Editor.
-- Every statement is fully idempotent: safe to re-run without data loss.

-- ── 1. Playback state table ───────────────────────────────────────────────────
create table if not exists public.playback_states (
  id            bigserial    primary key,
  user_id       text         not null,
  media_id      text         not null,
  playback_time integer      not null default 0,
  duration      integer,
  site          text,
  site_name     text,
  video_title   text,
  updated_at    timestamptz  not null default now(),
  constraint playback_states_user_id_media_id_key unique (user_id, media_id)
);

-- ── 2. Add new columns to existing tables (idempotent via DO block) ───────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'playback_states'
      and column_name  = 'site_name'
  ) then
    alter table public.playback_states add column site_name text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'playback_states'
      and column_name  = 'video_title'
  ) then
    alter table public.playback_states add column video_title text;
  end if;
end $$;

-- ── 3. Index for fast per-user lookups ───────────────────────────────────────
create index if not exists playback_states_user_id_idx
  on public.playback_states (user_id);

-- ── 4. Row-level security ─────────────────────────────────────────────────────
alter table public.playback_states enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'playback_states'
      and policyname = 'ss_anon_select'
  ) then
    execute 'create policy ss_anon_select on public.playback_states for select using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'playback_states'
      and policyname = 'ss_anon_insert'
  ) then
    execute 'create policy ss_anon_insert on public.playback_states for insert with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'playback_states'
      and policyname = 'ss_anon_update'
  ) then
    execute 'create policy ss_anon_update on public.playback_states for update using (true) with check (true)';
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
  if not exists (
    select 1 from pg_trigger
    where tgname    = 'ss_playback_states_updated_at'
      and tgrelid   = 'public.playback_states'::regclass
  ) then
    create trigger ss_playback_states_updated_at
      before update on public.playback_states
      for each row execute function public.ss_set_updated_at();
  end if;
end $$;

-- ── 6. Drop legacy upsert rule (conflicts with REST API ON CONFLICT syntax) ──
DROP RULE IF EXISTS playback_states_upsert ON public.playback_states;

-- ── 7. User settings table ────────────────────────────────────────────────────
-- Stores stats, preferences, site rules, and theme per user.
-- Synced automatically; used to restore settings on new installs.
create table if not exists public.user_settings (
  user_id     text         primary key,
  stats       jsonb        not null default '{}',
  prefs       jsonb        not null default '{}',
  site_rules  jsonb        not null default '{}',
  theme       text,
  updated_at  timestamptz  not null default now()
);

-- Row-level security for user_settings
alter table public.user_settings enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_settings' and policyname = 'ss_settings_select'
  ) then
    execute 'create policy ss_settings_select on public.user_settings for select using (true)';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_settings' and policyname = 'ss_settings_insert'
  ) then
    execute 'create policy ss_settings_insert on public.user_settings for insert with check (true)';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_settings' and policyname = 'ss_settings_update'
  ) then
    execute 'create policy ss_settings_update on public.user_settings for update using (true) with check (true)';
  end if;
end $$;

-- Auto-update trigger for user_settings
do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname  = 'ss_user_settings_updated_at'
      and tgrelid = 'public.user_settings'::regclass
  ) then
    create trigger ss_user_settings_updated_at
      before update on public.user_settings
      for each row execute function public.ss_set_updated_at();
  end if;
end $$;

-- Add device_name column to playback_states if not present
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'playback_states'
      and column_name  = 'device_name'
  ) then
    alter table public.playback_states add column device_name text;
  end if;
end $$;
