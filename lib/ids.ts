/** 학번 정규화 — DB의 normalize_student_no 와 같은 규칙 (숫자면 5자리, 공백 제거) */
export function normalizeStudentNo(v: unknown): string {
  const s = String(v ?? '').replace(/\s+/g, '').replace(/\.0$/, '');
  if (!s) return '';
  return /^\d+$/.test(s) && s.length < 5 ? s.padStart(5, '0') : s;
}

/** 학생은 학번으로 로그인 → 내부적으로 이 이메일을 씀 (메일은 보내지 않음) */
export function studentEmail(no: string): string {
  const domain = process.env.STUDENT_EMAIL_DOMAIN || 'student.chaoreum.local';
  return ('s' + normalizeStudentNo(no) + '@' + domain).toLowerCase();
}

/** 헷갈리는 글자(0/O, 1/l)를 뺀 임시 비밀번호 */
export function tempPassword(len = 8): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (x) => chars[x % chars.length]).join('');
}

export function seoulDate(d: string | Date, fmt: 'md' | 'mdhm' | 'ymd' = 'md'): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((x) => [x.type, x.value])
  ) as Record<string, string>;
  if (fmt === 'ymd') return `${p.year}-${p.month.padStart(2, '0')}-${p.day.padStart(2, '0')}`;
  if (fmt === 'mdhm') return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
  return `${p.month}/${p.day}`;
}
