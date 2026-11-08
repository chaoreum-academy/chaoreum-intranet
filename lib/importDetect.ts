/** 학생 명단 머리글 자동 인식 (엑셀·맥가이·구글 시트) */
/** 엑셀·CSV·붙여넣기 → 머리글 자동 인식 → 미리보기 → 확정 */
export const ALIASES = {
  student_no: ['학번', '학생번호', '원번', '회원번호', '고유번호'],
  name: ['학생이름', '학생명', '이름', '성명', '원생명', '원생이름'],
  school: ['학교', '학교명'],
  grade: ['학년', '학생학년'],
  phone: ['학생연락처', '학생휴대폰', '학생전화', '학생핸드폰', '연락처', '휴대폰'],
  guardian_name: ['보호자', '보호자명', '보호자이름', '학부모', '학부모명', '부모님'],
  guardian_phone: ['보호자연락처', '학부모연락처', '부모연락처', '보호자휴대폰', '학부모휴대폰', '보호자전화', '학부모전화', '부모님연락처'],
  classes: ['반', '학급', '학급명', '수강반', '반명', '수강반명', '수강반이름', '수강클래스', '클래스', '강좌', '강좌명', '수업', '수업명', '수강과목'],
} satisfies Record<string, string[]>;
export const LABELS: Record<keyof typeof ALIASES, string> = {
  student_no: '학번', name: '이름', school: '학교', grade: '학년', phone: '학생 연락처',
  guardian_name: '보호자', guardian_phone: '보호자 연락처', classes: '반',
};
export const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').trim();

export type Field = keyof typeof ALIASES;
export const FIELDS = Object.keys(ALIASES) as Field[];
const GUARD = /(보호자|학부모|부모|어머니|아버지|엄마|아빠|모친|부친)/;
const PHONE = /(연락|전화|휴대|핸드폰|폰|HP|hp|tel|TEL)/;

/** 머리글 한 칸이 어떤 정보인지: 정확한 이름 → 비슷한 이름 순으로 판단 */
export function guess(cell: string): Field | null {
  const c = norm(cell);
  if (!c) return null;
  for (const f of FIELDS) if (ALIASES[f].includes(c)) return f;
  if (PHONE.test(c)) return GUARD.test(c) ? 'guardian_phone' : 'phone';
  if (GUARD.test(c)) return 'guardian_name';
  if (/학번|원번|회원번호|고유번호/.test(c)) return 'student_no';
  if (/(수강|클래스|강좌|수업|학급|반명|반이름)/.test(c) || /반$/.test(c)) return 'classes';
  if (/학교/.test(c)) return 'school';
  if (/학년/.test(c)) return 'grade';
  if (/(이름|성명|원생명|학생명)/.test(c)) return 'name';
  return null;
}

export function detect(table: string[][]) {
  for (let r = 0; r < Math.min(table.length, 20); r++) {
    const map: Partial<Record<Field, number>> = {};
    table[r].forEach((cell, i) => { const f = guess(cell); if (f && map[f] === undefined) map[f] = i; });
    if (map.name !== undefined) return { head: r, map };
  }
  return null;
}


/* ── 반 칸 해석: "[철산2] [토 10시] 광북1A" → 지점 · 수업 시간 · 반 이름 ── */
export type ParsedClass = { branchToken: string | null; schedule: string; name: string };

function isSchedule(t: string) {
  return /^[월화수목금토일]{1,7}(\s|$|\d)/.test(t) || /\d{1,2}\s*(시|:\d{2})/.test(t);
}

/** 한 칸에 반이 여러 개일 수 있음: 쉼표·줄바꿈·세미콜론, 또는 "광북1A [철산2] …"처럼 대괄호로 새로 시작 */
export function parseClassCell(cell: string): ParsedClass[] {
  const text = String(cell || '').trim();
  if (!text) return [];
  const parts = text.split(/[,;·\n]+/).flatMap((p) => p.split(/(?<=[^\]\s])\s+(?=\[)/)).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => {
    const tags = Array.from(p.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1].trim());
    const name = p.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    let branchToken: string | null = null;
    let schedule = '';
    for (const t of tags) {
      if (!schedule && isSchedule(t)) schedule = t;
      else if (!branchToken) branchToken = t;
    }
    return { branchToken, schedule, name: name || p.replace(/[[\]]/g, '').trim() };
  }).filter((c) => c.name);
}

/** "[철산2]" "철산2관" "하안" "사회" → 지점 id (하나로 딱 정해질 때만) */
export function matchBranch(token: string | null, branches: { id: string; name: string }[]): string | null {
  if (!token) return null;
  const t = token.replace(/\s+/g, '').replace(/관$/, '');
  if (!t) return null;
  const n = (s: string) => s.replace(/\s+/g, '').replace(/관$/, '');
  const exact = branches.filter((b) => n(b.name) === t);
  if (exact.length === 1) return exact[0].id;
  const loose = branches.filter((b) => n(b.name).startsWith(t) || t.startsWith(n(b.name)));
  return loose.length === 1 ? loose[0].id : null;
}
