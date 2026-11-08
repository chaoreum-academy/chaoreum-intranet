-- 권한 테스트: 지점 분리, 강사 범위, 학생 정답 차단, 채점, 중복 제출
\set ON_ERROR_STOP on
\set QUIET on
-- 사람 만들기
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001','hq@x'),('00000000-0000-0000-0000-000000000002','mgr1@x'),
 ('00000000-0000-0000-0000-000000000003','mgr2@x'),('00000000-0000-0000-0000-000000000004','t1@x'),
 ('00000000-0000-0000-0000-000000000005','s1@x'),('00000000-0000-0000-0000-000000000006','s2@x'),
 ('00000000-0000-0000-0000-000000000007','p1@x');
insert into profiles(id,role,display_name) values
 ('00000000-0000-0000-0000-000000000001','hq_admin','본사'),('00000000-0000-0000-0000-000000000002','branch_manager','철산1실장'),
 ('00000000-0000-0000-0000-000000000003','branch_manager','하안실장'),('00000000-0000-0000-0000-000000000004','teacher','심진섭'),
 ('00000000-0000-0000-0000-000000000005','student','김민준'),('00000000-0000-0000-0000-000000000006','student','이서연'),
 ('00000000-0000-0000-0000-000000000007','parent','김민준어머니');
insert into staff_branches select '00000000-0000-0000-0000-000000000002', id from branches where name='철산1관';
insert into staff_branches select '00000000-0000-0000-0000-000000000003', id from branches where name='하안관';

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if; end $$;

-- 철산1관 실장이 학생·반 등록
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
insert into students(student_no,name,branch_id,user_id) select '3791','김민준',id,'00000000-0000-0000-0000-000000000005' from branches where name='철산1관';
insert into students(student_no,name,branch_id,user_id) select '03792','이서연',id,'00000000-0000-0000-0000-000000000006' from branches where name='철산1관';
select pg_temp.ok('학번 0 채우기 3791→03791', (select student_no from students where name='김민준')='03791');
insert into classes(branch_id,name,schedule) select id,'광북1A','토 10시' from branches where name='철산1관';
insert into class_teachers select id,'00000000-0000-0000-0000-000000000004','main' from classes where name='광북1A';
insert into enrollments(student_id,class_id) select s.id,c.id from students s, classes c where s.name='김민준' and c.name='광북1A';
do $$ begin
  begin
    insert into students(name,branch_id) select '몰래',id from branches where name='하안관';
    raise exception 'FAIL 다른 지점 학생 등록이 막혀야 함';
  exception when insufficient_privilege then raise notice 'PASS 철산1 실장은 하안관 학생 등록 불가'; end;
end $$;
reset role;

-- 하안관 실장은 철산1관 학생을 못 봄
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select pg_temp.ok('하안 실장에게 철산1 학생 0명', (select count(*) from students)=0);
reset role;

-- 강사: 담당 반 학생만 (이서연은 반에 없음)
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
select pg_temp.ok('강사는 담당 반 학생 1명만', (select count(*) from students)=1);
insert into exams(class_id,title,n_items,choices,is_open) select id,'복습테스트 1회',5,5,true from classes where name='광북1A';
insert into exam_keys select id, '{3,1,4,2,5}' from exams;
insert into exam_items(exam_id,no,area,concept) select id, g, case when g<=3 then '현대시' else '문법' end, '개념'||g from exams, generate_series(1,5) g;
reset role;

-- 학생: 정답 못 읽음, 제출·채점
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select pg_temp.ok('학생은 시험 1개 보임', (select count(*) from exams)=1);
select pg_temp.ok('학생은 정답 0줄', (select count(*) from exam_keys)=0);
select pg_temp.ok('제출 전 문항정보 안 보임', (select count(*) from exam_items)=0);
select pg_temp.ok('채점 4/5', (select (submit_exam((select id from exams), '{3,1,4,2,1}')->>'score')::int)=4);
select pg_temp.ok('제출 후 문항정보 보임', (select count(*) from exam_items)=5);
do $$ begin
  begin perform submit_exam((select id from exams), '{3,1,4,2,5}'); raise exception 'FAIL 중복 제출';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if; raise notice 'PASS 두 번째 제출 거절: %', sqlerrm; end;
end $$;
do $$ begin
  begin insert into submissions(exam_id,student_id,answers,ox,score,n) select id, my_student_id(), '{1}', '1', 100, 1 from exams;
        raise exception 'FAIL 점수 직접 입력';
  exception when insufficient_privilege then raise notice 'PASS 학생이 점수를 직접 써넣기 불가'; end;
end $$;
reset role;

-- 반에 없는 학생은 시험도 제출도 불가
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select pg_temp.ok('다른 학생에게 시험 0개', (select count(*) from exams)=0);
select pg_temp.ok('다른 학생에게 남의 제출 0건', (select count(*) from submissions)=0);
reset role;

-- 학부모 연결 후 자녀 결과만
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
insert into student_guardians select id,'00000000-0000-0000-0000-000000000007','모' from students where name='김민준';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000007');
select pg_temp.ok('학부모: 자녀 1명, 제출 1건', (select count(*) from students)=1 and (select count(*) from submissions)=1);
select pg_temp.ok('학부모: 정답 0줄', (select count(*) from exam_keys)=0);
reset role;

-- 반 이동: 종료 후 기록 유지
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
update enrollments set end_date=current_date;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select pg_temp.ok('반 종료 후에도 과거 제출·리포트 유지', (select count(*) from submissions)=1 and (select count(*) from exams)=1);
reset role;
select pg_temp.ok('변경 기록 남음', (select count(*) from audit_log) >= 5);

-- 정답 수정 → 다시 채점: 강사는 가능, 학생은 불가
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
update exam_keys set answers='{3,1,4,2,1}';
select pg_temp.ok('다시 채점 1건', regrade_exam((select id from exams))=1);
select pg_temp.ok('다시 채점 후 5/5', (select score from submissions)=5 and (select ox from submissions)='11111');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
do $$ begin
  begin perform regrade_exam((select id from exams)); raise exception 'FAIL 학생 재채점';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'PASS 학생은 다시 채점 불가'; end;
end $$;
reset role;

-- 출결: 강사 입력, 다른 지점 실장은 못 봄, 학생은 본인 것만
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
update enrollments set end_date=null;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
insert into attendance(student_id,class_id,status) select e.student_id,e.class_id,'late' from enrollments e;
select pg_temp.ok('강사가 출결 입력', (select count(*) from attendance)=1);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select pg_temp.ok('하안 실장에게 철산1 출결 0건', (select count(*) from attendance)=0);
do $$ begin
  begin insert into attendance(student_id,class_id,status) select s.id, c.id, 'absent' from students s, classes c limit 1;
        if (select count(*) from attendance) = 0 then raise notice 'PASS 다른 지점 출결 입력 불가(대상 안 보임)'; end if;
  exception when insufficient_privilege then raise notice 'PASS 다른 지점 출결 입력 불가'; end;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select pg_temp.ok('학생 본인 출결 1건', (select count(*) from attendance)=1);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select pg_temp.ok('다른 학생에게 출결 0건', (select count(*) from attendance)=0);
reset role;
\echo ALL_TESTS_DONE
