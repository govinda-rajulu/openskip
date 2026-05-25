-- SkipStream — Supabase Setup
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
  updated_at    timestamptz  not null default now(),
  constraint playback_states_user_media_uq unique (user_id, media_id)
);

-- ── 2. Index for fast per-user lookups ───────────────────────────────────────
create index if not exists playback_states_user_id_idx
  on public.playback_states (user_id);

-- ── 3. Row-level security ─────────────────────────────────────────────────────
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

-- ── 4. Auto-update updated_at trigger ────────────────────────────────────────
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
