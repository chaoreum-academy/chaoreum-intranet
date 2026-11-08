#!/usr/bin/env bash
# full_schema.sql: (1) 빈 DB에 두 번 실행 (2) 예전 0001~0002만 실행된 DB에 실행 → 모두 오류 없어야 함
set -euo pipefail
cd "$(dirname "$0")/.."
for DB in full_a full_b; do dropdb --if-exists $DB; createdb $DB; psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/auth_stub.sql; done
psql -q -v ON_ERROR_STOP=1 -d full_a -f full_schema.sql
psql -q -v ON_ERROR_STOP=1 -d full_a -f full_schema.sql
echo "A ok: $(psql -At -d full_a -c "select count(*) from information_schema.tables where table_schema='public'") tables, branches=$(psql -At -d full_a -c 'select count(*) from branches')"
git_old=/tmp/old_migrations
psql -q -v ON_ERROR_STOP=1 -d full_b -f $git_old/0001_core.sql
psql -q -v ON_ERROR_STOP=1 -d full_b -f $git_old/0002_omr.sql
psql -q -d full_b -c "insert into branches(name) values ('테스트관') on conflict do nothing"
psql -q -v ON_ERROR_STOP=1 -d full_b -f full_schema.sql
echo "B ok: $(psql -At -d full_b -c "select count(*) from information_schema.tables where table_schema='public'") tables, branches=$(psql -At -d full_b -c 'select count(*) from branches')"
