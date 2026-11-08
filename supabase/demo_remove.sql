-- 샘플 데이터만 삭제 (실제 학생·반은 그대로). 출결·OMR 결과도 함께 지워집니다.
delete from public.students where memo = '[샘플데이터]';
delete from public.classes where room = '[샘플]';
