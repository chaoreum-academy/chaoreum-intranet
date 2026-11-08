import { detect, guess } from '../lib/importDetect';
const cases: [string, string | null][] = [
  ['수강반', 'classes'], ['수강 반', 'classes'], ['수강반명', 'classes'], ['클래스', 'classes'], ['수강중인 반', 'classes'], ['반', 'classes'], ['학급명', 'classes'],
  ['학번', 'student_no'], ['원번', 'student_no'], ['학생이름', 'name'], ['원생명', 'name'], ['성명', 'name'],
  ['어머니 연락처', 'guardian_phone'], ['학부모 HP', 'guardian_phone'], ['보호자 휴대폰', 'guardian_phone'], ['학생 HP', 'phone'], ['연락처', 'phone'],
  ['보호자', 'guardian_name'], ['학교명', 'school'], ['학년', 'grade'], ['등록일', null], ['메모', null],
];
let bad = 0;
cases.forEach(([h, want]) => { const got = guess(h); if (got !== want) { bad++; console.log('FAIL', h, '→', got, '(기대', want, ')'); } });
const t = [['맥가이 원생목록'], [], ['원번', '원생명', '학교명', '학년', '학생 HP', '어머니 연락처', '수강반', '등록일'], ['3791', '김민준', '광북고', '고1', '010', '010-1', '광북1A, 광북1B', '2026']];
const d = detect(t);
const ok = d && d.head === 2 && d.map.classes === 6 && d.map.guardian_phone === 5 && d.map.phone === 4 && d.map.student_no === 0;
console.log(ok ? 'PASS 맥가이식 표 인식 (3번째 줄 머리글)' : 'FAIL 표 인식 ' + JSON.stringify(d));
console.log(`머리글 ${cases.length}개 중 실패 ${bad}`);
process.exit(bad || !ok ? 1 : 0);
