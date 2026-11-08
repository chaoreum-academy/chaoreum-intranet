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
