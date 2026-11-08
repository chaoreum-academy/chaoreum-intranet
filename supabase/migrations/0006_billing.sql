-- ============================================================
-- 0006_billing.sql : 수강료 청구·수납
-- 지금은 현장 수납(카드 단말기·현금·계좌이체)을 기록하고,
-- PG사(온라인 결제) 연동 후에는 payments에 method='online' + pg_* 칸으로 함께 쌓는다.
-- ============================================================

alter table public.classes add column if not exists monthly_fee int check (monthly_fee is null or monthly_fee >= 0);

do $$ begin
  create type public.pay_method as enum ('card', 'cash', 'transfer', 'online');
exception when duplicate_object then null; end $$;

-- 청구서: 학생 × 월 × 항목 한 줄 (같은 달 같은 항목은 한 번만)
create table if not exists public.bills (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  class_id   uuid references public.classes (id) on delete set null,
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  title      text not null,
  amount     int  not null check (amount >= 0),
  discount   int  not null default 0 check (discount >= 0 and discount <= amount),
  due_date   date,
  memo       text,
  cancelled  boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (student_id, month, title)
);
create index if not exists bills_month_idx on public.bills (month);
create index if not exists bills_student_idx on public.bills (student_id);

-- 수납 기록: 한 청구서에 여러 번 나눠 낼 수 있음. 음수 금액 = 환불
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references public.bills (id) on delete cascade,
  amount      int  not null check (amount <> 0),
  method      public.pay_method not null,
  paid_at     date not null default (now() at time zone 'Asia/Seoul')::date,
  memo        text,
  pg_provider text,   -- PG 연동 후: 결제사 이름
  pg_tid      text,   -- PG 연동 후: 결제 거래번호 (취소·대사용)
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists payments_bill_idx on public.payments (bill_id);
create unique index if not exists payments_pg_tid on public.payments (pg_provider, pg_tid) where pg_tid is not null;

drop trigger if exists bills_touch on public.bills;
create trigger bills_touch before update on public.bills for each row execute function public.touch_row();
drop trigger if exists bills_audit on public.bills;
create trigger bills_audit after insert or update or delete on public.bills for each row execute function public.audit_row();
drop trigger if exists payments_audit on public.payments;
create trigger payments_audit after insert or update or delete on public.payments for each row execute function public.audit_row();

create or replace function public.bill_student(b uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select student_id from public.bills where id = b
$$;

alter table public.bills    enable row level security;
alter table public.payments enable row level security;

-- 지점 실장·데스크·본사가 관리, 학부모는 자녀 것만 조회 (강사는 볼 수 없음)
drop policy if exists bills_read on public.bills;
create policy bills_read on public.bills for select to authenticated using (
  public.manages_branch(public.student_branch(student_id)) or public.guards_student(student_id)
);
drop policy if exists bills_write on public.bills;
create policy bills_write on public.bills for all to authenticated
  using (public.manages_branch(public.student_branch(student_id)))
  with check (public.manages_branch(public.student_branch(student_id)));

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated using (
  public.manages_branch(public.student_branch(public.bill_student(bill_id))) or public.guards_student(public.bill_student(bill_id))
);
drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments for all to authenticated
  using (public.manages_branch(public.student_branch(public.bill_student(bill_id))))
  with check (public.manages_branch(public.student_branch(public.bill_student(bill_id))));

grant select, insert, update, delete on public.bills    to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
