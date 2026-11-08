-- ============================================================
-- 0003_attendance.sql : 출결 + 학생 보호자 연락처
-- 출석·지각·결석·조퇴·보강을 반·날짜별로 한 줄씩 기록 (등원·하원 시각 포함)
-- ============================================================

alter table public.students
  add column if not exists guardian_name  text,
  add column if not exists guardian_phone text;

do $$ begin
  create type public.attendance_status as enum ('present', 'late', 'absent', 'early_leave', 'makeup');
exception when duplicate_object then null; end $$;

create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  class_id   uuid not null references public.classes (id) on delete cascade,
  date       date not null default (now() at time zone 'Asia/Seoul')::date,
  status     public.attendance_status not null,
  check_in   timestamptz,
  check_out  timestamptz,
  memo       text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (student_id, class_id, date)
);
create index if not exists attendance_date_idx on public.attendance (date);
create index if not exists attendance_class_idx on public.attendance (class_id, date);

drop trigger if exists attendance_touch on public.attendance;
drop trigger if exists attendance_audit on public.attendance;
drop trigger if exists attendance_touch on public.attendance;
create trigger attendance_touch before update on public.attendance for each row execute function public.touch_row();
drop trigger if exists attendance_audit on public.attendance;
create trigger attendance_audit after insert or update or delete on public.attendance for each row execute function public.audit_row();

create or replace function public.student_branch(s uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select branch_id from public.students where id = s
$$;

alter table public.attendance enable row level security;

drop policy if exists attendance_read on public.attendance;
drop policy if exists attendance_write on public.attendance;
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated using (
  public.manages_branch(public.student_branch(student_id)) or public.teaches_class(class_id)
  or student_id = public.my_student_id() or public.guards_student(student_id)
);
-- 담당 강사(수업 중 입력)와 지점 실장·데스크(등하원 처리)가 기록
drop policy if exists attendance_write on public.attendance;
create policy attendance_write on public.attendance for all to authenticated
  using (public.teaches_class(class_id) or public.manages_branch(public.class_branch(class_id)))
  with check (public.teaches_class(class_id) or public.manages_branch(public.class_branch(class_id)));

grant select, insert, update, delete on public.attendance to authenticated;
