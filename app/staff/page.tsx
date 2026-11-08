import Link from 'next/link';
import { Users, CalendarCheck, UserX, MessageSquare, AlertCircle, ChevronRight } from 'lucide-react';
import { requireRole, STAFF, BRANCH_ADMIN } from '@/lib/auth';
import { branchScope } from '@/lib/branch';
import { Avatar } from '@/components/Avatar';
import { pts } from '@/lib/omr/engine';
import { seoulDate } from '@/lib/ids';
import { classDays, seoulToday, STATUS_LABEL, STATUS_CLASS } from '@/lib/schedule';

/** 오늘 할 일 중심 홈. 숫자는 모두 내 권한 범위(RLS) + 상단 지점 선택 기준 */
export default async function Dashboard() {
  const me = await requireRole(STAFF);
  const sb = me.sb;
  const scope = await branchScope(me);
  const b = scope.current;
  const { ymd, day } = seoulToday();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  let cq = sb.from('classes').select('id, name, schedule, branch_id, branches(name), class_teachers(profiles(display_name)), enrollments(student_id, start_date, end_date)').eq('active', true);
  let sq = sb.from('students').select('id, status, user_id, student_no, guardian_phone, branch_id');
  if (b) { cq = cq.eq('branch_id', b); sq = sq.eq('branch_id', b); }
  const [{ data: classes }, { data: students }, { data: todayAtt }, { data: recent }, { data: failedLogs }, { data: sentLogs }] = await Promise.all([
    cq, sq,
    sb.from('attendance').select('student_id, class_id, status, memo, students(id, name, branch_id)').eq('date', ymd),
    sb.from('submissions').select('id, score, n, submitted_at, attempt, students(id, name, branch_id), exams(id, title, classes(name))').order('submitted_at', { ascending: false }).limit(8),
    sb.from('message_logs').select('id', { count: 'exact' }).neq('status', 'sent').gte('sent_at', since),
    sb.from('message_logs').select('id', { count: 'exact' }).eq('status', 'sent').gte('sent_at', since),
  ]);

  const cls = classes ?? [];
  const classIds = new Set(cls.map((c: any) => c.id));
  const active = (students ?? []).filter((s: any) => s.status === 'active');
  const att = (todayAtt ?? []).filter((a: any) => classIds.has(a.class_id));
  const todays = cls.filter((c: any) => classDays(c.schedule).includes(day)).map((c: any) => {
    const roster = (c.enrollments ?? []).filter((e: any) => e.start_date <= ymd && (!e.end_date || e.end_date >= ymd));
    const marked = att.filter((a: any) => a.class_id === c.id);
    return { ...c, time: String(c.schedule || '').replace(/^[월화수목금토일\s]+/, '') || '-', total: roster.length, checked: marked.length, absent: marked.filter((a: any) => a.status === 'absent').length };
  }).sort((x: any, y: any) => (parseInt(x.time) || 99) - (parseInt(y.time) || 99));

  const total = todays.reduce((t, c) => t + c.total, 0);
  const checked = todays.reduce((t, c) => t + c.checked, 0);
  const cnt = (k: string) => att.filter((a: any) => a.status === k).length;
  const issues = att.filter((a: any) => a.status !== 'present');
  const nameOf = (id: string) => cls.find((c: any) => c.id === id)?.name ?? '';
  const uncheckedClasses = todays.filter((c) => c.total && c.checked < c.total);
  const noPhone = active.filter((s: any) => !s.guardian_phone).length;
  const noAccount = active.filter((s: any) => !s.user_id && s.student_no).length;
  const canEdit = BRANCH_ADMIN.includes(me.role);
  const recentList = (recent ?? []).filter((r: any) => !b || r.students?.branch_id === b);

  const todo: { text: string; href: string; tone: string }[] = [];
  if (uncheckedClasses.length) todo.push({ text: `출결 미체크 반 ${uncheckedClasses.length}개`, href: `/staff/attendance?date=${ymd}&class=${uncheckedClasses[0].id}`, tone: 'bad' });
  if ((failedLogs?.length ?? 0) > 0) todo.push({ text: `알림톡 발송 실패 ${failedLogs!.length}건 (24시간)`, href: '/staff/messages?failed=1', tone: 'bad' });
  if (noPhone) todo.push({ text: `보호자 연락처 없는 학생 ${noPhone}명`, href: '/staff/students', tone: 'warn' });
  if (canEdit && noAccount) todo.push({ text: `로그인 계정 없는 학생 ${noAccount}명`, href: '/staff/students', tone: 'warn' });

  return (
    <>
      <div className="head">
        <div>
          <h1>안녕하세요, {me.name}님</h1>
          <div className="sub">{seoulDate(new Date())} ({day}) · {b ? scope.branches.find((x) => x.id === b)?.name : me.role === 'teacher' ? '담당 반 기준' : '전체 지점'}</div>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><span className="ic"><Users size={19} /></span><div><span>재원생</span><b>{active.length}</b><em>반 {cls.length}개 운영 중</em></div></div>
        <div className="stat"><span className="ic good"><CalendarCheck size={19} /></span><div><span>오늘 출결 체크</span><b>{checked}<span style={{ display: 'inline', fontSize: 15, color: 'var(--faint)' }}> / {total}</span></b>
          <div className="meter" aria-hidden="true">
            <span style={{ width: `${total ? (cnt('present') / total) * 100 : 0}%`, background: 'var(--good)' }} />
            <span style={{ width: `${total ? ((cnt('late') + cnt('early_leave')) / total) * 100 : 0}%`, background: 'var(--warn)' }} />
            <span style={{ width: `${total ? (cnt('absent') / total) * 100 : 0}%`, background: 'var(--bad)' }} />
          </div></div></div>
        <div className="stat"><span className="ic bad"><UserX size={19} /></span><div><span>오늘 결석</span><b style={{ color: cnt('absent') ? 'var(--bad)' : undefined }}>{cnt('absent')}</b><em>지각 {cnt('late')} · 조퇴 {cnt('early_leave')}</em></div></div>
        <div className="stat"><span className="ic"><MessageSquare size={19} /></span><div><span>알림톡 · 24시간</span><b>{sentLogs?.length ?? 0}</b><em>{failedLogs?.length ? `실패 ${failedLogs.length}건` : '실패 없음'}</em></div></div>
      </div>

      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className="panel">
          <div className="phead"><h2>오늘 수업 · {day}요일</h2><Link className="small" href="/staff/attendance">출결 입력 <ChevronRight size={13} style={{ verticalAlign: -2 }} /></Link></div>
          {!todays.length ? (
            <div className="empty">오늘 수업이 잡힌 반이 없습니다.<br /><span className="small">반의 「수업 시간」에 요일을 적어 두면(예: 월수 7시) 여기에 나옵니다.</span></div>
          ) : (
            <ul className="tl">
              {todays.map((c: any) => (
                <li key={c.id}>
                  <span className="time">{c.time}</span>
                  <span className="what"><b>{c.name}</b><span>{!b && me.role !== 'teacher' ? c.branches?.name + ' · ' : ''}{(c.class_teachers ?? []).map((t: any) => t.profiles?.display_name).join(', ') || '강사 미배정'} · {c.total}명</span></span>
                  <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                    {!!c.absent && <span className="badge bad">결석 {c.absent}</span>}
                    <Link href={`/staff/attendance?date=${ymd}&class=${c.id}`} className={'badge ' + (c.total && c.checked >= c.total ? 'good' : c.checked ? 'warn' : '')}>
                      {c.total && c.checked >= c.total ? '출결 완료' : `출결 ${c.checked}/${c.total}`}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel">
          <h2>확인할 일</h2>
          {!todo.length ? <div className="empty" style={{ padding: '20px 0' }}>지금 처리할 일이 없습니다.</div> : (
            <ul className="tl">
              {todo.map((t, i) => (
                <li key={i} style={{ gridTemplateColumns: '24px 1fr auto' }}>
                  <AlertCircle size={18} color={t.tone === 'bad' ? 'var(--bad)' : 'var(--warn)'} />
                  <Link href={t.href} style={{ color: 'var(--ink)' }}>{t.text}</Link>
                  <ChevronRight size={16} color="var(--faint)" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>오늘 결석·지각·조퇴</h2>
          {!issues.length ? <div className="empty">{checked ? '모두 출석했습니다.' : '아직 출결 기록이 없습니다.'}</div> : (
            <table className="t"><tbody>
              {issues.map((a: any, i: number) => (
                <tr key={i}>
                  <td><Link href={`/staff/students/${a.students?.id}`} className="person"><Avatar name={a.students?.name} /><b>{a.students?.name}</b></Link></td>
                  <td className="small">{nameOf(a.class_id)}</td>
                  <td><span className={'badge ' + STATUS_CLASS[a.status]}>{STATUS_LABEL[a.status]}</span></td>
                  <td className="small muted">{a.memo}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
        <div className="panel">
          <div className="phead"><h2>최근 OMR 제출</h2><Link className="small" href="/staff/exams">전체 <ChevronRight size={13} style={{ verticalAlign: -2 }} /></Link></div>
          {!recentList.length ? <div className="empty">아직 제출이 없습니다.</div> : (
            <table className="t"><tbody>
              {recentList.map((r: any) => (
                <tr key={r.id}>
                  <td><Link href={`/staff/students/${r.students?.id}`} className="person"><Avatar name={r.students?.name} /><span><b>{r.students?.name}</b><span className="meta">{r.exams?.title}</span></span></Link></td>
                  <td className="num small muted">{seoulDate(r.submitted_at, 'mdhm')}</td>
                  <td className="r num"><b>{pts(r.score, r.n)}</b><span className="muted small">점</span></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
    </>
  );
}
