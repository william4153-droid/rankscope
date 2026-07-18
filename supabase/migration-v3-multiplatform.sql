-- RankScope V3 migration for an existing Supabase project.
-- Run once in Supabase Dashboard > SQL Editor before deploying V3.

alter table public.search_history
  add column if not exists platform text;

alter table public.search_history
  add column if not exists research_goal text;

update public.search_history
set platform = 'google'
where platform is null or platform = '';

update public.search_history
set research_goal = 'Balanced keyword ideas'
where research_goal is null or research_goal = '';

alter table public.search_history
  alter column platform set default 'google',
  alter column platform set not null,
  alter column research_goal set default 'Balanced keyword ideas',
  alter column research_goal set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'search_history_platform_check'
      and conrelid = 'public.search_history'::regclass
  ) then
    alter table public.search_history
      add constraint search_history_platform_check
      check (platform in ('google', 'youtube', 'etsy', 'amazon', 'ebay'));
  end if;
end $$;

create index if not exists search_history_platform_idx
  on public.search_history (platform, searched_at desc);
