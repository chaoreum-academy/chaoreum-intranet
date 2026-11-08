-- ============================================================
-- 샘플 데이터 넣기 (화면이 어떻게 보이는지 확인용)
-- 철산1관에 샘플 반 4개 · 학생 18명 · 지난 3주 출결 · OMR 시험 4개를 만듭니다.
-- 실장님(본사 관리자)이 강사로 배정되어 출결·시험 화면을 바로 써 볼 수 있습니다.
-- 다 보고 나면 demo_remove.sql 로 샘플만 깨끗이 지웁니다. (실제 데이터는 건드리지 않음)
-- ============================================================
do $$
declare
  v_branch uuid; v_teacher uuid; v_class uuid; v_exam uuid; v_sid uuid;
  names   text[] := array['김민준','이서연','박지호','최유나','정하윤','강도윤','윤서아','임준서','한지민',
                          '오은우','신예린','서지안','권태윤','황보민','조하람','배수아','류시우','남궁현'];
  v_schools text[] := array['광북고','명문고','진성고','광명고'];
  cnames  text[] := array['광북1A','명문2B','진성1C','광명2A'];
  scheds  text[] := array['월수금 7시','화목 6시','토 10시','일 2시'];
  areas   text[] := array['현대시','문법','독서','고전시가'];
  i int; k int; d date; dayc text; st public.attendance_status; r float;
  v_key smallint[]; v_ans smallint[]; v_ox text; v_score int; a int;
begin
  select id into v_branch from public.branches where name = '철산1관';
  select id into v_teacher from public.profiles where role = 'hq_admin' and active order by created_at limit 1;
  if v_teacher is null then raise exception '본사 관리자 계정이 없습니다. bootstrap_admin.sql 을 먼저 실행하세요.'; end if;
  if exists (select 1 from public.students where memo = '[샘플데이터]') then raise exception '샘플 데이터가 이미 있습니다. 다시 넣으려면 demo_remove.sql 을 먼저 실행하세요.'; end if;

  insert into public.schools (name, level) select unnest(v_schools), 'high' on conflict (name) do nothing;

  for k in 1..4 loop
    insert into public.classes (branch_id, name, subject, grade, schedule, room)
    values (v_branch, cnames[k] || ' (샘플)', '국어', case when k in (2, 4) then 2 else 1 end, scheds[k], '[샘플]')
    returning id into v_class;
    insert into public.class_teachers (class_id, user_id, role) values (v_class, v_teacher, 'main');
  end loop;

  for i in 1..18 loop
    k := ((i - 1) % 4) + 1;
    insert into public.students (student_no, name, branch_id, school_id, grade, phone, guardian_name, guardian_phone, memo, homeroom_teacher_id)
    values ('9' || lpad(i::text, 4, '0'), names[i], v_branch,
            (select id from public.schools where name = v_schools[k]), case when k in (2, 4) then 2 else 1 end,
            '010-' || lpad((1000 + i * 37)::text, 4, '0') || '-' || lpad((2000 + i * 53)::text, 4, '0'),
            '어머니', '010-' || lpad((5000 + i * 41)::text, 4, '0') || '-' || lpad((3000 + i * 29)::text, 4, '0'),
            '[샘플데이터]', v_teacher)
    returning id into v_sid;
    insert into public.enrollments (student_id, class_id, start_date)
    select v_sid, id, current_date - 60 from public.classes where room = '[샘플]' and name = cnames[k] || ' (샘플)';
  end loop;

  -- 지난 3주 출결 (오늘은 비워 둠 → 대시보드에서 '미체크'로 보임)
  for d in select generate_series(current_date - 21, current_date - 1, interval '1 day')::date loop
    dayc := substr('일월화수목금토', extract(dow from d)::int + 1, 1);
    for v_class in select id from public.classes where room = '[샘플]' and position(dayc in split_part(schedule, ' ', 1)) > 0 loop
      for v_sid in select student_id from public.enrollments where class_id = v_class loop
        r := random();
        st := case when r < 0.84 then 'present' when r < 0.92 then 'late' when r < 0.97 then 'absent' else 'early_leave' end;
        insert into public.attendance (student_id, class_id, date, status, check_in, check_out, memo)
        values (v_sid, v_class, d, st,
                case when st <> 'absent' then (d + time '18:50' + (random() * interval '25 minutes')) at time zone 'Asia/Seoul' end,
                case when st <> 'absent' then (d + time '21:00' - case when st = 'early_leave' then interval '50 minutes' else interval '0' end) at time zone 'Asia/Seoul' end,
                case when st = 'absent' then '병결 연락받음' when st = 'late' then '학교 보충수업' end);
      end loop;
    end loop;
  end loop;

  -- 반마다 OMR 시험 1개 + 응시 결과
  for v_class in select id from public.classes where room = '[샘플]' loop
    insert into public.exams (class_id, title, n_items, choices, is_open, guide)
    values (v_class, '복습테스트 1회 (샘플)', 10, 5, true, '아주 잘했어요!|조금만 더 힘내요.|복습이 꼭 필요해요.')
    returning id into v_exam;
    v_key := array(select (1 + floor(random() * 5))::smallint from generate_series(1, 10));
    insert into public.exam_keys (exam_id, answers) values (v_exam, v_key);
    insert into public.exam_items (exam_id, no, area, concept, fix)
    select v_exam, g, areas[((g - 1) / 3) % 4 + 1], '핵심 개념 ' || g, '틀린 개념을 표로 정리하고 다시 외웁니다.' from generate_series(1, 10) g;
    for v_sid in select student_id from public.enrollments where class_id = v_class loop
      continue when random() < 0.2;   -- 일부는 미제출
      v_ans := '{}'; v_ox := ''; v_score := 0;
      for i in 1..10 loop
        a := case when random() < 0.72 then v_key[i] else (1 + floor(random() * 5))::int end;
        v_ans := v_ans || a::smallint;
        if a = v_key[i] then v_ox := v_ox || '1'; v_score := v_score + 1; else v_ox := v_ox || '0'; end if;
      end loop;
      insert into public.submissions (exam_id, student_id, attempt, answers, ox, score, n, submitted_at)
      values (v_exam, v_sid, 1, v_ans, v_ox, v_score, 10, now() - (random() * interval '3 days'));
    end loop;
  end loop;

  raise notice '샘플 데이터를 넣었습니다: 반 4 · 학생 18 · 출결 % 건', (select count(*) from public.attendance a join public.students s on s.id = a.student_id where s.memo = '[샘플데이터]');
end $$;
