#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DB=chaoreum_seed
dropdb --if-exists $DB; createdb $DB
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/auth_stub.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done
psql -q -d $DB -c "insert into auth.users values ('00000000-0000-0000-0000-000000000001','hq@x'); insert into profiles(id,role,display_name) values ('00000000-0000-0000-0000-000000000001','hq_admin','실장');"
psql -v ON_ERROR_STOP=1 -d $DB -f demo_seed.sql
psql -d $DB -At -c "select 'classes', count(*) from classes union all select 'students', count(*) from students union all select 'attendance', count(*) from attendance union all select 'exams', count(*) from exams union all select 'subs', count(*) from submissions union all select 'status '||status, count(*) from attendance group by status"
# 출결 권한: 강사로 배정된 실장이 읽고 쓰기
psql -v ON_ERROR_STOP=1 -d $DB <<'SQL'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
set role authenticated;
select 'visible attendance', count(*) from attendance;
insert into attendance(student_id,class_id,status) select e.student_id, e.class_id, 'present' from enrollments e limit 1;
select 'insert ok';
reset role;
SQL
psql -v ON_ERROR_STOP=1 -d $DB -f demo_remove.sql
psql -d $DB -At -c "select 'after remove students', count(*) from students; select 'after remove attendance', count(*) from attendance;"
