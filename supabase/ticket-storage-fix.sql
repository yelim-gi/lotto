-- 내 번호 / 내 구매 저장 기능 보정 SQL
-- Supabase SQL Editor에서 한 번 실행하세요. 기존 데이터는 삭제하지 않습니다.

alter table public.saved_tickets
  add column if not exists ticket_type text not null default 'saved';

alter table public.saved_tickets
  drop constraint if exists saved_ticket_type_check;

alter table public.saved_tickets
  add constraint saved_ticket_type_check
  check (ticket_type in ('saved', 'purchased'));

alter table public.saved_tickets enable row level security;

drop policy if exists "own tickets select" on public.saved_tickets;
create policy "own tickets select"
on public.saved_tickets for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "own tickets insert" on public.saved_tickets;
create policy "own tickets insert"
on public.saved_tickets for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "own tickets delete" on public.saved_tickets;
create policy "own tickets delete"
on public.saved_tickets for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists saved_tickets_user_idx
  on public.saved_tickets(user_id);

create index if not exists saved_tickets_type_idx
  on public.saved_tickets(user_id, ticket_type);
