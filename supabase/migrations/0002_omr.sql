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
