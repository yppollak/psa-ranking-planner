-- PSA Ranking Planner — captured world rankings.
-- Run this once in the Supabase SQL editor, after entries.sql.
-- Safe to re-run: every statement is idempotent.

-- 1. One row per ranked player per tour. The whole list, not a sample: the
--    honest average (total ÷ tournaments) needs exact figures for everyone.
create table if not exists public.rankings (
  division          text not null check (division in ('men','women')),
  rank              int  not null,
  name              text not null,
  ranked_on         date not null,
  country           text,
  player_ranking_id text,
  total             numeric,
  counting          numeric,
  average           numeric,
  played            int,
  divisor           int,
  capture_id        text,
  captured_at       timestamptz not null default now(),
  primary key (division, rank, name)     -- the tail is full of shared ranks
);
create index if not exists rankings_lookup_idx on public.rankings (division, lower(name));
create index if not exists rankings_order_idx  on public.rankings (division, rank);

alter table public.rankings enable row level security;
drop policy if exists "rankings: read all" on public.rankings;
create policy "rankings: read all" on public.rankings
  for select to authenticated using (true);

-- Migration, for anyone who already ran the first version of this file.
alter table public.rankings add column if not exists capture_id text;

-- 2. The only write path. Same ingest token as the entry lists.
--    The extension sends the list in pages, all tagged with one capture id; the
--    last call for a division sets p_final, which deletes every row for that
--    division this capture did not write. Keying the cleanup on the capture
--    rather than on the ranking date means re-running the same week's list
--    replaces it, instead of leaving the previous attempt's rows behind.
drop function if exists public.ingest_rankings(text, text, date, jsonb, boolean);

create or replace function public.ingest_rankings(
  p_token      text,
  p_division   text,
  p_ranked_on  date,
  p_rows       jsonb,
  p_final      boolean default false,
  p_capture_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid;
  v_row     jsonb;
  v_count   int := 0;
  v_removed int := 0;
  v_total   int := 0;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid ingest token' using errcode = '28000';
  end if;

  select id into v_user from public.profiles where ingest_token = p_token;
  if v_user is null then
    raise exception 'invalid ingest token' using errcode = '28000';
  end if;

  if p_division not in ('men','women') then
    raise exception 'division must be men or women' using errcode = '22023';
  end if;
  if p_ranked_on is null then
    raise exception 'ranked_on is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce(v_row->>'name', '') = '' or (v_row->>'rank') is null;
    v_count := v_count + 1;

    insert into public.rankings (
      division, rank, name, ranked_on, country, player_ranking_id,
      total, counting, average, played, divisor, capture_id, captured_at)
    values (
      p_division,
      (v_row->>'rank')::int,
      v_row->>'name',
      p_ranked_on,
      nullif(v_row->>'country', ''),
      nullif(v_row->>'player_ranking_id', ''),
      nullif(v_row->>'total', '')::numeric,
      nullif(v_row->>'counting', '')::numeric,
      nullif(v_row->>'average', '')::numeric,
      nullif(v_row->>'played', '')::int,
      nullif(v_row->>'divisor', '')::int,
      p_capture_id,
      now())
    on conflict (division, rank, name) do update set
      ranked_on         = excluded.ranked_on,
      country           = excluded.country,
      player_ranking_id = excluded.player_ranking_id,
      total             = excluded.total,
      counting          = excluded.counting,
      average           = excluded.average,
      played            = excluded.played,
      divisor           = excluded.divisor,
      capture_id        = excluded.capture_id,
      captured_at       = excluded.captured_at;
  end loop;

  if p_final then
    if p_capture_id is null then
      delete from public.rankings
      where division = p_division and ranked_on <> p_ranked_on;
    else
      delete from public.rankings
      where division = p_division and capture_id is distinct from p_capture_id;
    end if;
    get diagnostics v_removed = row_count;
  end if;

  select count(*) into v_total from public.rankings where division = p_division;
  return jsonb_build_object('received', v_count, 'removed', v_removed, 'stored', v_total);
end $$;

grant execute on function public.ingest_rankings(text, text, date, jsonb, boolean, text) to anon, authenticated;

-- 3. What the planner shows under Settings: how fresh each tour's list is.
create or replace function public.rankings_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(division, jsonb_build_object(
           'ranked_on', ranked_on, 'players', players, 'captured_at', captured_at)), '{}'::jsonb)
  from (
    select division, max(ranked_on) as ranked_on, count(*) as players, max(captured_at) as captured_at
    from public.rankings group by division
  ) t
$$;

grant execute on function public.rankings_summary() to authenticated;
