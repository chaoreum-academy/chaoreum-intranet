-- ============================================================
-- 차오름학원 데이터베이스 전체 (한 파일)
-- 처음 설치든, 이미 일부 실행했든 상관없이 이 파일 하나를 실행하면 최신 상태가 됩니다.
-- 기존 학생·반·시험 데이터는 지워지지 않습니다.
-- ============================================================

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

-- ============================================================
-- 0002_omr.sql : 과제·복습테스트 OMR 자동 채점
--
-- 기존 시트 → 새 표
--   설정     → exams (+ exam_keys : 정답은 학생이 절대 못 읽는 별도 표)
--   문항정보 → exam_items
--   웹응답·누적 → submissions (응시 차수 attempt 로 재시험 구분)
-- 채점은 submit_exam() 함수가 DB 안에서 한다 → 학생 화면에 정답이 내려가지 않음
-- 점수 100점 환산·코멘트·문자는 앱(lib/omr/engine.ts)이 계산 (원본과 글자까지 동일 검증)
-- ============================================================

create table if not exists public.exams (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes (id) on delete cascade,
  title        text not null,
  n_items      int  not null check (n_items between 1 and 200),
  choices      smallint not null default 5 check (choices between 2 and 9),
  opens_at     timestamptz,                       -- 시작일시 (비우면 바로)
  is_open      boolean not null default false,    -- 열기 O/X
  allow_retake boolean not null default false,    -- 재시험 허용 (원본은 항상 1회)
  guide        text,                              -- 문자 안내 "잘함|보통|부족"
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid(),
  unique (class_id, title)
);
drop trigger if exists exams_touch on public.exams;
create trigger exams_touch before update on public.exams for each row execute function public.touch_row();
drop trigger if exists exams_audit on public.exams;
create trigger exams_audit after insert or update or delete on public.exams for each row execute function public.audit_row();

create table if not exists public.exam_keys (
  exam_id uuid primary key references public.exams (id) on delete cascade,
  answers smallint[] not null
);

create table if not exists public.exam_items (
  exam_id uuid not null references public.exams (id) on delete cascade,
  no      int  not null check (no >= 1),
  area    text,          -- 영역
  concept text,          -- 핵심 개념
  fix     text,          -- 보완 방법
  qtype   text,          -- 문제 유형
  source  text,          -- 출처
  traps   text,          -- 선지별 함정
  subject text,          -- 과목
  detail  text,          -- 세부·갈래
  format  text,          -- 형식
  primary key (exam_id, no)
);

create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  exam_id      uuid not null references public.exams (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  attempt      smallint not null default 1,
  answers      smallint[] not null,   -- 0 = 빈칸
  ox           text not null,         -- '10110…'
  score        int not null,          -- 맞힌 개수
  n            int not null,
  submitted_at timestamptz not null default now(),
  unique (exam_id, student_id, attempt)
);
create index if not exists submissions_student_idx on public.submissions (student_id);

-- ---------- 권한 판단 ----------
create or replace function public.exam_class(e uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select class_id from public.exams where id = e
$$;

create or replace function public.staff_of_class(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.teaches_class(c) or public.manages_branch(public.class_branch(c))
$$;

/** 지금 이 반을 다니는 학생 본인인가 */
create or replace function public.i_attend_class(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.enrollments e join public.students s on s.id = e.student_id
    where e.class_id = c and e.end_date is null and s.user_id = auth.uid() and s.status = 'active'
  )
$$;

/** 학생 본인 또는 학부모가 이 시험을 응시(자녀 응시)했는가 */
create or replace function public.family_took_exam(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.submissions sb
    where sb.exam_id = e and (sb.student_id = public.my_student_id() or public.guards_student(sb.student_id))
  )
$$;

alter table public.exams       enable row level security;
alter table public.exam_keys   enable row level security;
alter table public.exam_items  enable row level security;
alter table public.submissions enable row level security;

drop policy if exists exams_read on public.exams;
create policy exams_read on public.exams for select to authenticated using (
  public.staff_of_class(class_id)
  or (public.i_attend_class(class_id) and is_open and (opens_at is null or opens_at <= now()))
  or public.family_took_exam(id)
);
drop policy if exists exams_write on public.exams;
create policy exams_write on public.exams for all to authenticated
  using (public.staff_of_class(class_id)) with check (public.staff_of_class(class_id));

-- 정답: 담당 강사·지점 관리자만
drop policy if exists exam_keys_all on public.exam_keys;
create policy exam_keys_all on public.exam_keys for all to authenticated
  using (public.staff_of_class(public.exam_class(exam_id))) with check (public.staff_of_class(public.exam_class(exam_id)));

-- 문항정보(정답 없음): 직원 + 응시한 학생·학부모 (리포트 영역 분석용)
drop policy if exists exam_items_read on public.exam_items;
create policy exam_items_read on public.exam_items for select to authenticated using (
  public.staff_of_class(public.exam_class(exam_id)) or public.family_took_exam(exam_id)
);
drop policy if exists exam_items_write on public.exam_items;
create policy exam_items_write on public.exam_items for all to authenticated
  using (public.staff_of_class(public.exam_class(exam_id))) with check (public.staff_of_class(public.exam_class(exam_id)));

-- 제출: 직접 쓰기 금지(정책 없음) → submit_exam() 으로만. 읽기는 본인·학부모·담당 직원
drop policy if exists submissions_read on public.submissions;
create policy submissions_read on public.submissions for select to authenticated using (
  student_id = public.my_student_id() or public.guards_student(student_id) or public.staff_of_class(public.exam_class(exam_id))
);
drop policy if exists submissions_delete on public.submissions;
create policy submissions_delete on public.submissions for delete to authenticated using (
  public.staff_of_class(public.exam_class(exam_id))
);

-- ---------- 제출 + 채점 ----------
create or replace function public.submit_exam(p_exam uuid, p_answers int[])
returns json language plpgsql security definer set search_path = public as $$
declare
  v_student uuid := public.my_student_id();
  v_exam    public.exams;
  v_key     smallint[];
  v_attempt int;
  v_ox      text := '';
  v_score   int := 0;
  v_wrong   int[] := '{}';
  v_ans     smallint[] := '{}';
  i         int;
  a         int;
begin
  if v_student is null then raise exception '학생 계정으로 로그인해 주세요.'; end if;

  select * into v_exam from public.exams where id = p_exam;
  if not found then raise exception '시험을 찾을 수 없어요.'; end if;
  if not public.i_attend_class(v_exam.class_id) then raise exception '우리 반 시험이 아니에요.'; end if;
  if not v_exam.is_open or (v_exam.opens_at is not null and v_exam.opens_at > now()) then
    raise exception '아직 열리지 않았거나 마감된 시험이에요.';
  end if;

  select answers into v_key from public.exam_keys where exam_id = p_exam;
  if v_key is null or coalesce(array_length(v_key, 1), 0) < v_exam.n_items then
    raise exception '선생님이 정답을 아직 다 입력하지 않았어요.';
  end if;

  -- 같은 학생이 동시에 두 번 누르는 것 방지
  perform pg_advisory_xact_lock(hashtext(p_exam::text || v_student::text));

  select coalesce(max(attempt), 0) + 1 into v_attempt
    from public.submissions where exam_id = p_exam and student_id = v_student;
  if v_attempt > 1 and not v_exam.allow_retake then raise exception '이미 제출했어요.'; end if;

  for i in 1 .. v_exam.n_items loop
    a := coalesce(p_answers[i], 0);
    if a < 0 or a > v_exam.choices then a := 0; end if;
    v_ans := v_ans || a::smallint;
    if a = v_key[i] then
      v_ox := v_ox || '1'; v_score := v_score + 1;
    else
      v_ox := v_ox || '0'; v_wrong := v_wrong || i;
    end if;
  end loop;

  insert into public.submissions (exam_id, student_id, attempt, answers, ox, score, n)
  values (p_exam, v_student, v_attempt, v_ans, v_ox, v_score, v_exam.n_items);

  return json_build_object('score', v_score, 'n', v_exam.n_items, 'wrong', v_wrong, 'ox', v_ox, 'attempt', v_attempt);
end $$;

/** 같은 반·같은 시험 1차 응시자들의 OX (이름 없이). 리포트 '보완 필요' 판정용 */
create or replace function public.exam_peer_ox(p_exam uuid) returns setof text
language sql stable security definer set search_path = public as $$
  select sb.ox from public.submissions sb
  where sb.exam_id = p_exam and sb.attempt = 1
    and (public.family_took_exam(p_exam) or public.staff_of_class(public.exam_class(p_exam)))
$$;

revoke all on function public.submit_exam(uuid, int[]) from public;
grant execute on function public.submit_exam(uuid, int[]) to authenticated;
grant execute on function public.exam_peer_ox(uuid) to authenticated;

grant select, insert, update, delete on public.exams, public.exam_keys, public.exam_items, public.submissions to authenticated;

-- ---------- 정답 수정 후 다시 채점 (담당 강사·지점 관리자만) ----------
create or replace function public.regrade_exam(p_exam uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_key smallint[];
  v_n   int;
  c     int;
begin
  if not public.staff_of_class(public.exam_class(p_exam)) then raise exception '권한이 없습니다.'; end if;
  select answers into v_key from public.exam_keys where exam_id = p_exam;
  select n_items into v_n from public.exams where id = p_exam;
  update public.submissions s set
    ox = (select string_agg(case when s.answers[i] = v_key[i] then '1' else '0' end, '' order by i) from generate_series(1, v_n) i),
    score = (select count(*) from generate_series(1, v_n) i where s.answers[i] = v_key[i])
  where s.exam_id = p_exam;
  get diagnostics c = row_count;
  return c;
end $$;
grant execute on function public.regrade_exam(uuid) to authenticated;

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

-- ============================================================
-- 0004_notify.sql : 알림톡(알리고) 템플릿 · 시험별 자동 발송 · 발송 기록
-- 알리고에서 카카오 승인을 받은 템플릿을 그대로 등록하고, #{학생명} 같은 변수를 채워 보낸다
-- ============================================================

create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                  -- 화면에 보일 이름 (예: OMR 결과 안내)
  tpl_code    text not null,                  -- 알리고 템플릿 코드
  subject     text not null default '차오름학원',
  body        text not null,                  -- 승인된 본문 그대로 (#{변수} 포함)
  button_json text,                           -- 템플릿에 버튼이 있으면 알리고 버튼 JSON
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

alter table public.exams
  add column if not exists notify_template_id uuid references public.message_templates (id) on delete set null,
  add column if not exists notify_auto boolean not null default false;

create table if not exists public.message_logs (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid references public.students (id) on delete set null,
  exam_id       uuid references public.exams (id) on delete set null,
  submission_id uuid references public.submissions (id) on delete set null,
  template_id   uuid references public.message_templates (id) on delete set null,
  receiver      text,
  body          text,
  status        text not null check (status in ('sent', 'failed', 'skipped')),
  result        text,
  trigger       text not null default 'manual' check (trigger in ('auto', 'manual', 'test')),
  sent_at       timestamptz not null default now(),
  sent_by       uuid
);
create index if not exists message_logs_sub_idx on public.message_logs (submission_id);
create index if not exists message_logs_time_idx on public.message_logs (sent_at desc);

alter table public.message_templates enable row level security;
alter table public.message_logs      enable row level security;

drop policy if exists templates_read on public.message_templates;
drop policy if exists templates_write on public.message_templates;
drop policy if exists templates_read on public.message_templates;
create policy templates_read on public.message_templates for select to authenticated using (public.is_staff());
drop policy if exists templates_write on public.message_templates;
create policy templates_write on public.message_templates for all to authenticated
  using (coalesce(public.my_role() in ('hq_admin', 'branch_manager'), false))
  with check (coalesce(public.my_role() in ('hq_admin', 'branch_manager'), false));

-- 발송 기록: 쓰기는 서버(관리자 키)만. 읽기는 그 학생·시험을 볼 수 있는 직원
drop policy if exists logs_read on public.message_logs;
create policy logs_read on public.message_logs for select to authenticated using (
  public.is_hq()
  or (student_id is not null and public.manages_branch(public.student_branch(student_id)))
  or (exam_id is not null and public.staff_of_class(public.exam_class(exam_id)))
);

grant select, insert, update, delete on public.message_templates to authenticated;
grant select on public.message_logs to authenticated;

-- ============================================================
-- 0005_settings.sql : 연동 설정 (알리고 키 등) — 본사 관리자만 읽고 쓰기
-- 화면에서는 값의 앞뒤 일부만 보여 주고, 실제 값은 서버가 발송할 때만 꺼낸다
-- ============================================================
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.app_settings enable row level security;
drop policy if exists settings_hq on public.app_settings;
create policy settings_hq on public.app_settings for all to authenticated using (public.is_hq()) with check (public.is_hq());
grant select, insert, update, delete on public.app_settings to authenticated;


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

