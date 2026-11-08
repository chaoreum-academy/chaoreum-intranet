#!/usr/bin/env bash
# 로컬 PostgreSQL로 마이그레이션 + 권한 테스트 (개발자용)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=chaoreum_test
dropdb --if-exists $DB; createdb $DB
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/auth_stub.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done
psql -v ON_ERROR_STOP=1 -d $DB -f tests/rls_test.sql
