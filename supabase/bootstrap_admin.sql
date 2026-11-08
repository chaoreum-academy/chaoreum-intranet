-- 최초 1회: 본사 관리자 계정 지정
-- 1) Supabase 대시보드 > Authentication > Users > "Add user" 로 실장님 이메일·비밀번호 생성 (Auto Confirm 체크)
-- 2) 아래 이메일과 이름을 바꿔 SQL Editor 에서 실행
insert into public.profiles (id, role, display_name)
select id, 'hq_admin', '운영총괄 실장'
from auth.users
where email = 'admin@example.com'
on conflict (id) do update set role = 'hq_admin', active = true;
