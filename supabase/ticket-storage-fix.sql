create extension if not exists pgcrypto;

create table if not exists public.saved_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  client_id uuid,
  label text,
  target_draw_no integer,
  numbers integer[] not null,
  ticket_type text not null default 'saved',
  created_at timestamptz not null default now(),
  constraint saved_numbers_six check(cardinality(numbers) = 6)
);

alter table public.saved_tickets alter column user_id drop not null;
alter table public.saved_tickets add column if not exists client_id uuid;
alter table public.saved_tickets add column if not exists ticket_type text not null default 'saved';
alter table public.saved_tickets add column if not exists target_draw_no integer;
alter table public.saved_tickets add column if not exists created_at timestamptz not null default now();

alter table public.saved_tickets drop constraint if exists saved_ticket_type_check;
alter table public.saved_tickets add constraint saved_ticket_type_check check (ticket_type in ('saved', 'purchased'));

create index if not exists saved_tickets_client_idx on public.saved_tickets(client_id, created_at desc);
create index if not exists saved_tickets_client_type_idx on public.saved_tickets(client_id, ticket_type, created_at desc);

-- 저장/조회는 Vercel 서버 함수가 service_role 키로 수행하므로 브라우저 인증 정책은 사용하지 않습니다.
alter table public.saved_tickets enable row level security;
drop policy if exists "own tickets select" on public.saved_tickets;
drop policy if exists "own tickets insert" on public.saved_tickets;
drop policy if exists "own tickets delete" on public.saved_tickets;
drop policy if exists "client tickets select" on public.saved_tickets;
drop policy if exists "client tickets insert" on public.saved_tickets;
drop policy if exists "client tickets delete" on public.saved_tickets;
