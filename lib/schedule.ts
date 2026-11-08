/** 반의 '수업 시간' 글자에서 요일 뽑기: "월수 7시" → ['월','수'], "토 10시" → ['토'] */
export function classDays(schedule: string | null | undefined): string[] {
  const head = String(schedule || '').split(/\d/)[0];
  return Array.from(new Set(head.split('').filter((c) => '월화수목금토일'.includes(c))));
}

export function seoulToday(): { ymd: string; day: string } {
  const now = new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(now).map((x) => [x.type, x.value])
  ) as Record<string, string>;
  return { ymd: `${p.year}-${p.month}-${p.day}`.replace(/\s|\./g, ''), day: p.weekday.replace(/요일/, '') };
}

/** 'YYYY-MM-DD'의 요일 (서울 기준 날짜이므로 정오로 계산) */
export function dayOf(ymd: string): string {
  return '일월화수목금토'.charAt(new Date(ymd + 'T12:00:00+09:00').getUTCDay());
}

export const STATUS_LABEL: Record<string, string> = {
  present: '출석', late: '지각', absent: '결석', early_leave: '조퇴', makeup: '보강',
};
export const STATUS_CLASS: Record<string, string> = {
  present: 'good', late: 'warn', absent: 'bad', early_leave: 'warn', makeup: 'navy',
};
