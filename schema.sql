-- PSA Ranking Planner — database setup.
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to re-run: every statement is idempotent.

-- 1. Profiles: one row per signed-in user, created automatically on first sign-in.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- The first admin. Change the address below to yours before running.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, is_admin)
  values (new.id, new.email, lower(new.email) = lower('yppollak@gmail.com'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- 2. Players: one row per player profile. `data` holds the whole planner state as JSON
--    (history, planner choices, expected rounds, travel matrix, official card).
create table if not exists public.players (
  id text primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists players_owner_idx on public.players(owner);

-- 3. Shared reference data (tournament schedule, rankings snapshots). Admin-writable, everyone-readable.
create table if not exists public.shared (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 4. Row-level security.
alter table public.profiles enable row level security;
alter table public.players  enable row level security;
alter table public.shared   enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "players: read own or admin" on public.players;
create policy "players: read own or admin" on public.players for select to authenticated using (owner = auth.uid() or public.is_admin());
drop policy if exists "players: insert own or admin" on public.players;
create policy "players: insert own or admin" on public.players for insert to authenticated with check (owner = auth.uid() or public.is_admin());
drop policy if exists "players: update own or admin" on public.players;
create policy "players: update own or admin" on public.players for update to authenticated using (owner = auth.uid() or public.is_admin()) with check (owner = auth.uid() or public.is_admin());
drop policy if exists "players: delete own or admin" on public.players;
create policy "players: delete own or admin" on public.players for delete to authenticated using (owner = auth.uid() or public.is_admin());

drop policy if exists "shared: read all" on public.shared;
create policy "shared: read all" on public.shared for select to authenticated using (true);
drop policy if exists "shared: admin writes" on public.shared;
create policy "shared: admin writes" on public.shared for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5. Backfill a profile for anyone who signed in before this script ran.
insert into public.profiles (id, email, is_admin)
select id, email, lower(email) = lower('yppollak@gmail.com') from auth.users
on conflict (id) do nothing;
