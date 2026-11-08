import Link from 'next/link';
import { requireRole, STAFF } from '@/lib/auth';
import { Flash } from '@/components/Flash';
import { seoulDate } from '@/lib/ids';
import { classDays, dayOf, seoulToday, STATUS_LABEL } from '@/lib/schedule';
import { mark, checkout, saveMemo, markAllPresent } from './actions';
import { branchScope } from '@/lib/branch';
import { SubmitButton } from '@/components/SubmitButton';
import { Avatar } from '@/components/Avatar';

export default async function AttendancePage({ searchParams }: { searchParams: { date?: string; class?: string; ok?: string; err?: string } }) {
  const me = await requireRole(STAFF);
  const today = seoulToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date || '') ? searchParams.date! : today.ymd;
  const day = dayOf(date);

  const scope = await branchScope(me);
  let cq = me.sb.from('classes').select('id, name, schedule, branches(name, sort)').eq('active', true).order('name');
  if (scope.current) cq = cq.eq('branch_id', scope.current);
  const { data: classes } = await cq;
  const all = (classes ?? []) as any[];
  const todays = all.filter((c) => classDays(c.schedule).includes(day));
  const others = all.filter((c) => !classDays(c.schedule).includes(day));
  const selected = all.find((c) => c.id === searchParams.class) ?? todays[0] ?? null;

  let roster: any[] = [];
  const rec: Record<string, any> = {};
  if (selected) {
    const [{ data: enr }, { data: att }] = await Promise.all([
      me.sb.from('enrollments').select('student_id, start_date, end_date, students(id, name, student_no, status, schools(name), grade)')
        .eq('class_id', selected.id).lte('start_date', date),
      me.sb.from('attendance').select('student_id, status, check_in, check_out, memo').eq('class_id', selected.id).eq('date', date),
    ]);
    roster = (enr ?? []).filter((e: any) => (!e.end_date || e.end_date >= date) && e.students?.status !== 'withdrawn')
      .map((e: any) => e.students).filter(Boolean).sort((a: any, b: any) => a.name.localeCompare(b.name, 'ko'));
    (att ?? []).forEach((a: any) => { rec[a.student_id] = a; });
  }
  const count = (s: string) => roster.filter((r) => rec[r.id]?.status === s).length;
  const unchecked = roster.filter((r) => !rec[r.id]);
  const shift = (n: number) => { const d = new Date(date + 'T12:00:00+09:00'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const link = (c: string, d = date) => `/staff/attendance?date=${d}&class=${c}`;

  return (
    <>
      <div className="head">
        <div>
          <h1>출결</h1>
          <div className="sub">버튼 한 번으로 저장됩니다. 출석·지각을 누르면 등원 시각이 함께 남습니다.</div>
        </div>
        <form className="row" method="get">
          <Link className="btn ghost" href={`/staff/attendance?date=${shift(-1)}${selected ? '&class=' + selected.id : ''}`}>◀ 전날</Link>
          <input type="date" name="date" defaultValue={date} />
          {selected && <input type="hidden" name="class" value={selected.id} />}
          <button className="btn ghost">이동</button>
          <Link className="btn ghost" href={`/staff/attendance?date=${shift(1)}${selected ? '&class=' + selected.id : ''}`}>다음날 ▶</Link>
          {date !== today.ymd && <Link className="btn" href="/staff/attendance">오늘</Link>}
        </form>
      </div>
      <Flash sp={{ ok: searchParams.ok || undefined, err: searchParams.err }} />

      <div className="panel">
        <h3>{date.slice(5).replace('-', '/')} ({day}) 수업 반</h3>
        {!all.length ? <p className="muted">담당 반이 없습니다. 「반」 메뉴에서 반을 만들거나 배정받으세요.</p> : (
          <>
            <div className="pills">
              {todays.length ? todays.map((c) => <Link key={c.id} href={link(c.id)} className={selected?.id === c.id ? 'on' : ''}>{c.name} <span className="small">{c.schedule}</span></Link>)
                : <span className="muted small">이 요일에 수업이 잡힌 반이 없습니다. 반의 「수업 시간」에 요일(예: 월수 7시)을 적어 두면 여기 나옵니다.</span>}
            </div>
            {!!others.length && (
              <details><summary className="small">다른 반 ({others.length})</summary>
                <div className="pills" style={{ marginTop: 8 }}>{others.map((c) => <Link key={c.id} href={link(c.id)} className={selected?.id === c.id ? 'on' : ''}>{c.name}</Link>)}</div>
              </details>
            )}
          </>
        )}
      </div>

      {selected && (
        <div className="panel">
          <div className="phead">
            <div>
              <h2>{selected.name}</h2>
              <div className="muted small">{selected.branches?.name} · {selected.schedule}</div>
            </div>
            <div className="row">
              <span className="badge good">출석 {count('present')}</span>
              <span className="badge warn">지각 {count('late')}</span>
              <span className="badge bad">결석 {count('absent')}</span>
              <span className="badge warn">조퇴 {count('early_leave')}</span>
              <span className="badge">미체크 {unchecked.length}</span>
              {!!unchecked.length && (
                <form action={markAllPresent}>
                  <input type="hidden" name="date" value={date} /><input type="hidden" name="class_id" value={selected.id} />
                  {unchecked.map((s) => <input key={s.id} type="hidden" name="student_id" value={s.id} />)}
                  <SubmitButton className="btn sm">미체크 {unchecked.length}명 전원 출석</SubmitButton>
                </form>
              )}
            </div>
          </div>
          {!roster.length ? <div className="empty">이 날짜에 수강 중인 학생이 없습니다.</div> : (
            <div className="scroll">
              <table className="t">
                <thead><tr><th>이름</th><th>출결</th><th>등원</th><th>하원</th><th>메모</th></tr></thead>
                <tbody>
                  {roster.map((s) => {
                    const r = rec[s.id];
                    return (
                      <tr key={s.id}>
                        <td><Link href={`/staff/students/${s.id}`} className="person"><Avatar name={s.name} /><span><b>{s.name}</b><span className="meta">{s.schools?.name} {s.grade ? s.grade + '학년' : ''}</span></span></Link></td>
                        <td>
                          <form action={mark} className="att">
                            <input type="hidden" name="date" value={date} /><input type="hidden" name="class_id" value={selected.id} /><input type="hidden" name="student_id" value={s.id} />
                            {Object.entries(STATUS_LABEL).map(([k, v]) => (
                              <SubmitButton key={k} name="status" value={k} className={(r?.status === k ? 'on ' : '') + k} pendingText="…">{v}</SubmitButton>
                            ))}
                          </form>
                        </td>
                        <td className="num small">{r?.check_in ? seoulDate(r.check_in, 'mdhm').split(' ')[1] : <span className="muted">-</span>}</td>
                        <td className="num small">
                          {r?.check_out ? seoulDate(r.check_out, 'mdhm').split(' ')[1] : r?.check_in ? (
                            <form action={checkout}>
                              <input type="hidden" name="date" value={date} /><input type="hidden" name="class_id" value={selected.id} /><input type="hidden" name="student_id" value={s.id} />
                              <button className="btn ghost sm">하원</button>
                            </form>
                          ) : <span className="muted">-</span>}
                        </td>
                        <td>
                          {r ? (
                            <form action={saveMemo} className="row">
                              <input type="hidden" name="date" value={date} /><input type="hidden" name="class_id" value={selected.id} /><input type="hidden" name="student_id" value={s.id} />
                              <input name="memo" defaultValue={r.memo ?? ''} placeholder="사유·특이사항" size={14} />
                              <button className="btn ghost sm">저장</button>
                            </form>
                          ) : <span className="muted small">출결 먼저</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
