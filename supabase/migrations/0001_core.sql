-- ============================================================
-- 0001_core.sql : 지점 · 계정 · 학생 · 반 · 수강 + 권한(RLS)
--
-- 권한 원칙
--  · 본사 관리자(hq_admin) : 전 지점
--  · 지점 실장·데스크       : staff_branches 에 등록된 지점만
--  · 강사                  : 담당 반(class_teachers)과 그 반 학생만, 담임 학생 포함
--  · 학생                  : 본인만 / 학부모 : 연결된 자녀만
-- 화면이 아니라 DB가 막으므로, 화면에 실수가 있어도 다른 지점 정보는 새지 않는다.
-- ============================================================

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('hq_admin', 'branch_manager', 'desk', 'teacher', 'student', 'parent');
exception when duplicate_object then null; end $$;

-- ---------- 지점 ----------
create table if not exists public.branches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

insert into public.branches (name, sort) values
  ('철산1관', 1), ('철산2관', 2), ('하안관', 3), ('논술관', 4), ('사회과학관', 5)
on conflict (name) do nothing;

-- ---------- 계정(로그인한 사람) ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.app_role not null,
  display_name text not null,
  phone        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.staff_branches (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  primary key (user_id, branch_id)
);

-- ---------- 학교 ----------
create table if not exists public.schools (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique,
  level text not null default 'other' check (level in ('middle', 'high', 'other'))
);

-- ---------- 학생 ----------
-- 학번 규칙: 숫자만이면 앞에 0을 채워 5자리 (기존 클리닉 시스템 규칙. OMR 시스템의 '0 지우기'와 달랐던 부분 통일)
create or replace function public.normalize_student_no(v text) returns text
language sql immutable as $$
  select case
    when v is null or btrim(v) = '' then null
    when regexp_replace(v, '\s+', '', 'g') ~ '^\d+$' and length(regexp_replace(v, '\s+', '', 'g')) < 5
      then lpad(regexp_replace(v, '\s+', '', 'g'), 5, '0')
    else regexp_replace(v, '\s+', '', 'g')
  end
$$;

create table if not exists public.students (
  id                  uuid primary key default gen_random_uuid(),
  student_no          text unique,                                   -- 맥가이 학번 (외부 번호)
  user_id             uuid unique references public.profiles (id) on delete set null,
  name                text not null,
  school_id           uuid references public.schools (id),
  grade               smallint check (grade between 1 and 6),
  branch_id           uuid not null references public.branches (id),
  homeroom_teacher_id uuid references public.profiles (id) on delete set null,
  phone               text,
  status              text not null default 'active' check (status in ('active', 'paused', 'withdrawn')),
  memo                text,
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid default auth.uid()
);
create index if not exists students_branch_idx on public.students (branch_id);
create index if not exists students_name_idx on public.students (name);

create table if not exists public.student_guardians (
  student_id uuid not null references public.students (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  relation   text,
  primary key (student_id, user_id)
);

-- ---------- 반 ----------
create table if not exists public.classes (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches (id),
  name       text not null,                 -- 예: 광북1A
  subject    text,
  school_id  uuid references public.schools (id),
  grade      smallint check (grade between 1 and 6),
  schedule   text,                          -- 예: 토 10시
  room       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (branch_id, name)
);

create table if not exists public.class_teachers (
  class_id uuid not null references public.classes (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  role     text not null default 'main' check (role in ('main', 'assistant')),
  primary key (class_id, user_id)
);

-- ---------- 수강 (반 이동은 종료일을 넣고 새 줄 생성 → 과거 기록 보존) ----------
create table if not exists public.enrollments (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  class_id   uuid not null references public.classes (id) on delete cascade,
  start_date date not null default current_date,
  end_date   date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (end_date is null or end_date >= start_date)
);
create unique index if not exists enrollments_one_active on public.enrollments (student_id, class_id) where end_date is null;
create index if not exists enrollments_class_idx on public.enrollments (class_id);

-- ---------- 공통 트리거 ----------
create or replace function public.touch_row() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create or replace function public.students_normalize() returns trigger language plpgsql as $$
begin
  new.student_no := public.normalize_student_no(new.student_no);
  new.name := btrim(new.name);
  return new;
end $$;

drop trigger if exists students_touch on public.students;
create trigger students_touch    before update on public.students    for each row execute function public.touch_row();
drop trigger if exists classes_touch on public.classes;
create trigger classes_touch     before update on public.classes     for each row execute function public.touch_row();
drop trigger if exists enrollments_touch on public.enrollments;
create trigger enrollments_touch before update on public.enrollments for each row execute function public.touch_row();
drop trigger if exists students_norm on public.students;
create trigger students_norm     before insert or update on public.students for each row execute function public.students_normalize();

-- ---------- 변경 기록 (누가 언제 무엇을) ----------
create table if not exists public.audit_log (
  id         bigserial primary key,
  table_name text not null,
  row_id     text,
  action     text not null,
  actor      uuid default auth.uid(),
  at         timestamptz not null default now(),
  old_row    jsonb,
  new_row    jsonb
);

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, row_id, action, old_row, new_row)
  values (tg_table_name,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

drop trigger if exists students_audit on public.students;
create trigger students_audit    after insert or update or delete on public.students    for each row execute function public.audit_row();
drop trigger if exists classes_audit on public.classes;
create trigger classes_audit     after insert or update or delete on public.classes     for each row execute function public.audit_row();
drop trigger if exists enrollments_audit on public.enrollments;
create trigger enrollments_audit after insert or update or delete on public.enrollments for each row execute function public.audit_row();

-- ============================================================
-- 권한 판단 함수 (security definer: 판단할 때만 RLS를 건너뛰어 무한 반복을 막음)
-- ============================================================
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_hq() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'hq_admin', false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('hq_admin', 'branch_manager', 'desk', 'teacher'), false)
$$;

/** 지점 전체를 다룰 수 있는가 (본사 / 그 지점 실장·데스크) */
create or replace function public.manages_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hq() or (
    coalesce(public.my_role() in ('branch_manager', 'desk'), false)
    and exists (select 1 from public.staff_branches sb where sb.user_id = auth.uid() and sb.branch_id = b)
  )
$$;

/** 지점 등록·삭제 같은 실장급 작업 (데스크 제외) */
create or replace function public.leads_branch(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hq() or (
    coalesce(public.my_role() = 'branch_manager', false)
    and exists (select 1 from public.staff_branches sb where sb.user_id = auth.uid() and sb.branch_id = b)
  )
$$;

create or replace function public.class_branch(c uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select branch_id from public.classes where id = c
$$;

create or replace function public.teaches_class(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_teachers ct where ct.class_id = c and ct.user_id = auth.uid())
$$;

create or replace function public.my_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.students where user_id = auth.uid()
$$;

create or replace function public.teaches_student(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.enrollments e
    join public.class_teachers ct on ct.class_id = e.class_id
    where e.student_id = s and e.end_date is null and ct.user_id = auth.uid()
  ) or exists (select 1 from public.students st where st.id = s and st.homeroom_teacher_id = auth.uid())
$$;

create or replace function public.guards_student(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.student_guardians g where g.student_id = s and g.user_id = auth.uid())
$$;

/** 내가(학생) 또는 내 자녀가 이 반에 다니고 있거나 다녔는가 */
create or replace function public.family_in_class(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.enrollments e
    left join public.students st on st.id = e.student_id
    where e.class_id = c
      and (st.user_id = auth.uid()
           or exists (select 1 from public.student_guardians g where g.student_id = e.student_id and g.user_id = auth.uid()))
  )
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table public.branches          enable row level security;
alter table public.profiles          enable row level security;
alter table public.staff_branches    enable row level security;
alter table public.schools           enable row level security;
alter table public.students          enable row level security;
alter table public.student_guardians enable row level security;
alter table public.classes           enable row level security;
alter table public.class_teachers    enable row level security;
alter table public.enrollments       enable row level security;
alter table public.audit_log         enable row level security;

-- 지점 이름은 로그인한 모두에게 공개
drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches for select to authenticated using (true);
drop policy if exists branches_write on public.branches;
create policy branches_write on public.branches for all    to authenticated using (public.is_hq()) with check (public.is_hq());

-- 계정: 본인 또는 직원끼리 이름 조회. 생성·역할 변경은 서버(관리자 키)에서만
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (public.is_hq()) with check (public.is_hq());

drop policy if exists staff_branches_read on public.staff_branches;
create policy staff_branches_read on public.staff_branches for select to authenticated using (public.is_staff());
drop policy if exists staff_branches_write on public.staff_branches;
create policy staff_branches_write on public.staff_branches for all    to authenticated using (public.is_hq()) with check (public.is_hq());

drop policy if exists schools_read on public.schools;
create policy schools_read on public.schools for select to authenticated using (true);
drop policy if exists schools_write on public.schools;
create policy schools_write on public.schools for insert to authenticated with check (public.is_staff());

drop policy if exists students_read on public.students;
create policy students_read on public.students for select to authenticated using (
  public.manages_branch(branch_id) or public.teaches_student(id) or user_id = auth.uid() or public.guards_student(id)
);
drop policy if exists students_insert on public.students;
create policy students_insert on public.students for insert to authenticated with check (public.manages_branch(branch_id));
drop policy if exists students_update on public.students;
create policy students_update on public.students for update to authenticated
  using (public.manages_branch(branch_id)) with check (public.manages_branch(branch_id));
drop policy if exists students_delete on public.students;
create policy students_delete on public.students for delete to authenticated using (public.is_hq());

drop policy if exists guardians_read on public.student_guardians;
create policy guardians_read on public.student_guardians for select to authenticated using (
  user_id = auth.uid() or public.manages_branch((select branch_id from public.students s where s.id = student_id))
);
drop policy if exists guardians_write on public.student_guardians;
create policy guardians_write on public.student_guardians for all to authenticated
  using (public.manages_branch((select branch_id from public.students s where s.id = student_id)))
  with check (public.manages_branch((select branch_id from public.students s where s.id = student_id)));

drop policy if exists classes_read on public.classes;
create policy classes_read on public.classes for select to authenticated using (
  public.manages_branch(branch_id) or public.teaches_class(id) or public.family_in_class(id)
);
drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes for insert to authenticated with check (public.leads_branch(branch_id));
drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes for update to authenticated
  using (public.leads_branch(branch_id)) with check (public.leads_branch(branch_id));
drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes for delete to authenticated using (public.is_hq());

drop policy if exists class_teachers_read on public.class_teachers;
create policy class_teachers_read on public.class_teachers for select to authenticated using (public.is_staff());
drop policy if exists class_teachers_write on public.class_teachers;
create policy class_teachers_write on public.class_teachers for all to authenticated
  using (public.leads_branch(public.class_branch(class_id))) with check (public.leads_branch(public.class_branch(class_id)));

drop policy if exists enrollments_read on public.enrollments;
create policy enrollments_read on public.enrollments for select to authenticated using (
  public.manages_branch(public.class_branch(class_id)) or public.teaches_class(class_id)
  or student_id = public.my_student_id() or public.guards_student(student_id)
);
drop policy if exists enrollments_write on public.enrollments;
create policy enrollments_write on public.enrollments for all to authenticated
  using (public.manages_branch(public.class_branch(class_id)))
  with check (public.manages_branch(public.class_branch(class_id)));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_hq());

-- Supabase는 기본으로 권한을 주지만, 명시해 둔다 (RLS가 실제 문지기)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
