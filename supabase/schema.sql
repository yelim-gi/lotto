create extension if not exists pgcrypto;

create table if not exists public.lotto_draws (
 draw_no integer primary key,
 draw_date date not null,
 numbers integer[] not null,
 bonus_no integer not null,
 source text not null default 'seed',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint lotto_numbers_six check(cardinality(numbers)=6),
 constraint lotto_bonus_range check(bonus_no between 1 and 45),
 constraint lotto_bonus_not_winner check(not bonus_no=any(numbers))
);

create table if not exists public.saved_tickets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 label text,
 target_draw_no integer,
 numbers integer[] not null,
 ticket_type text not null default 'saved',
 created_at timestamptz not null default now(),
 constraint saved_numbers_six check(cardinality(numbers)=6)
);

alter table public.saved_tickets add column if not exists ticket_type text not null default 'saved';
alter table public.saved_tickets drop constraint if exists saved_ticket_type_check;
alter table public.saved_tickets add constraint saved_ticket_type_check check(ticket_type in ('saved','purchased'));

alter table public.lotto_draws enable row level security;
alter table public.saved_tickets enable row level security;

drop policy if exists "lotto public read" on public.lotto_draws;
create policy "lotto public read" on public.lotto_draws for select using(true);

drop policy if exists "own tickets select" on public.saved_tickets;
create policy "own tickets select" on public.saved_tickets for select to authenticated using(auth.uid()=user_id);
drop policy if exists "own tickets insert" on public.saved_tickets;
create policy "own tickets insert" on public.saved_tickets for insert to authenticated with check(auth.uid()=user_id);
drop policy if exists "own tickets delete" on public.saved_tickets;
create policy "own tickets delete" on public.saved_tickets for delete to authenticated using(auth.uid()=user_id);

create index if not exists saved_tickets_user_idx on public.saved_tickets(user_id);
create index if not exists saved_tickets_type_idx on public.saved_tickets(user_id,ticket_type);
