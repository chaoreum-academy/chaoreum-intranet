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
