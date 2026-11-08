import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Phone, KeyRound } from 'lucide-react';
import { requireRole, STAFF, BRANCH_ADMIN } from '@/lib/auth';
import { Flash } from '@/components/Flash';
import { Avatar } from '@/components/Avatar';
import { seoulDate } from '@/lib/ids';
import { pts } from '@/lib/omr/engine';
import { STATUS_LABEL, STATUS_CLASS, seoulToday } from '@/lib/schedule';
import { updateStudent, setStatus, createLogin, resetPassword } from '../actions';

const ST: Record<string, [string, string]> = { active: ['재원', 'good'], paused: ['휴원', 'warn'], withdrawn: ['퇴원', ''] };
const TABS: [string, string][] = [['info', '기본 정보'], ['attendance', '출결'], ['omr', 'OMR 과제'], ['messages', '알림톡']];

export default async function StudentCard({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string; ok?: string; err?: string } }) {
  const me = await requireRole(STAFF);
  const tab = TABS.some(([k]) => k === searchParams.tab) ? searchParams.tab! : 'info';
  const { data: st } = await me.sb.from('students')
    .select('id, name, student_no, grade, status, phone, guardian_name, guardian_phone, memo, user_id, created_at, branches(name), schools(name), enrollments(id, start_date, end_date, classes(id, name, schedule)), student_guardians(relation, profiles(display_name))')
    .eq('id', params.id).maybeSingle();
  if (!st) notFound();
  const s: any = st;
  const canEdit = BRANCH_ADMIN.includes(me.role);
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);

  const [{ data: att }, { data: subs }, { data: logs }] = await Promise.all([
    me.sb.from('attendance').select('date, status, check_in, check_out, memo, classes(name)').eq('student_id', s.id).gte('date', since).order('date', { ascending: false }),
    me.sb.from('submissions').select('id, score, n, attempt, submitted_at, exams(id, title, classes(name))').eq('student_id', s.id).order('submitted_at', { ascending: false }).limit(50),
    me.sb.from('message_logs').select('id, status, result, trigger, sent_at, body, exams(title)').eq('student_id', s.id).order('sent_at', { ascending: false }).limit(50),
  ]);
  const a = att ?? [];
  const cnt = (k: string) => a.filter((x: any) => x.status === k).length;
  const rate = a.length ? Math.round(((cnt('present') + cnt('late') + cnt('makeup')) / a.length) * 100) : null;
  const firstSubs = (subs ?? []).filter((x: any) => x.attempt === 1);
  const avg = firstSubs.length ? Math.round(firstSubs.reduce((t: number, x: any) => t + pts(x.score, x.n), 0) / firstSubs.length) : null;
  const current = (s.enrollments ?? []).filter((e: any) => !e.end_date);
  const past = (s.enrollments ?? []).filter((e: any) => e.end_date);
  const today = seoulToday().ymd;
  const tabLink = (k: string) => `/staff/students/${s.id}?tab=${k}`;

  return (
    <>
      <div className="crumb"><Link href="/staff/students">학생</Link></div>
      <div className="panel" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Avatar name={s.name} size="lg" />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{s.name} <span className={'badge ' + ST[s.status][1]}>{ST[s.status][0]}</span></h1>
          <div className="muted small" style={{ marginTop: 4 }}>{s.student_no ?? '학번 없음'} · {s.branches?.name} · {s.schools?.name ?? ''} {s.grade ? s.grade + '학년' : ''}</div>
          <div className="chips" style={{ marginTop: 8 }}>{current.map((e: any) => <Link key={e.id} className="chip" href={`/staff/classes/${e.classes?.id}`}>{e.classes?.name}</Link>)}</div>
        </div>
        <div style={{ fontSize: 14 }}>
          <div className="row" style={{ alignItems: 'center', gap: 6 }}><Phone size={14} color="var(--faint)" />보호자 {s.guardian_name ?? ''} <b className="num">{s.guardian_phone ?? '없음'}</b></div>
          {s.phone && <div className="muted small num" style={{ marginTop: 4, marginLeft: 20 }}>학생 {s.phone}</div>}
        </div>
      </div>
      <Flash sp={searchParams} />

      <div className="stats">
        <div className="stat"><div><span>출석률 · 최근 90일</span><b>{rate === null ? '-' : rate + '%'}</b><em>기록 {a.length}회</em></div></div>
        <div className="stat"><div><span>결석 · 지각</span><b style={{ color: cnt('absent') ? 'var(--bad)' : undefined }}>{cnt('absent')} · {cnt('late')}</b><em>조퇴 {cnt('early_leave')}</em></div></div>
        <div className="stat"><div><span>OMR 평균</span><b>{avg ?? '-'}</b><em>{firstSubs.length}회 응시</em></div></div>
        <div className="stat"><div><span>알림톡</span><b>{(logs ?? []).filter((l: any) => l.status === 'sent').length}</b><em>최근 발송 건수</em></div></div>
      </div>

      <nav className="tabs">{TABS.map(([k, v]) => <Link key={k} href={tabLink(k)} className={tab === k ? 'on' : ''}>{v}</Link>)}</nav>

      {tab === 'info' && (
        <div className="grid3">
          <div className="panel">
            <h2>기본 정보</h2>
            {canEdit ? (
              <form action={updateStudent}>
                <input type="hidden" name="id" value={s.id} />
                <div className="row">
                  <label className="field">이름<input name="name" defaultValue={s.name} required size={8} /></label>
                  <label className="field">학번<input name="student_no" defaultValue={s.student_no ?? ''} size={7} /></label>
                  <label className="field">학교<input name="school" defaultValue={s.schools?.name ?? ''} size={8} /></label>
                  <label className="field">학년<input name="grade" defaultValue={s.grade ?? ''} size={3} /></label>
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <label className="field">학생 연락처<input name="phone" defaultValue={s.phone ?? ''} size={13} inputMode="tel" /></label>
                  <label className="field">보호자<input name="guardian_name" defaultValue={s.guardian_name ?? ''} size={8} placeholder="어머니" /></label>
                  <label className="field">보호자 연락처 (알림톡 받는 번호)<input name="guardian_phone" defaultValue={s.guardian_phone ?? ''} size={14} inputMode="tel" /></label>
                </div>
                <label className="field" style={{ marginTop: 12 }}>메모 · 학습 특이사항<textarea name="memo" defaultValue={s.memo ?? ''} style={{ minHeight: 80 }} /></label>
                <span style={{ display: 'inline-block', marginTop: 12 }}><SubmitButton>저장</SubmitButton></span>
              </form>
            ) : (
              <dl className="kv">
                <dt>학생 연락처</dt><dd>{s.phone ?? '-'}</dd>
                <dt>보호자</dt><dd>{s.guardian_name ?? '-'} {s.guardian_phone ?? ''}</dd>
                <dt>메모</dt><dd style={{ whiteSpace: 'pre-line' }}>{s.memo ?? '-'}</dd>
              </dl>
            )}
          </div>
          <div className="stack" style={{ marginBottom: 0 }}>
            {canEdit && (
              <div className="panel" style={{ marginBottom: 0 }}>
                <h2>상태 · 계정</h2>
                <form action={setStatus} className="row">
                  <input type="hidden" name="id" value={s.id} />
                  <select name="status" defaultValue={s.status} aria-label="상태">{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
                  <button className="btn ghost">상태 저장</button>
                </form>
                <dl className="kv" style={{ marginTop: 14 }}>
                  <dt>학생 로그인</dt><dd>{s.user_id ? <span className="badge good">있음 · 아이디 {s.student_no}</span> : <span className="badge">없음</span>}</dd>
                  <dt>학부모 계정</dt><dd>{(s.student_guardians ?? []).map((g: any) => `${g.profiles?.display_name}${g.relation ? ` (${g.relation})` : ''}`).join(', ') || <span className="muted">없음</span>}</dd>
                  <dt>등록일</dt><dd className="num">{seoulDate(s.created_at, 'ymd')}</dd>
                </dl>
                <form action={s.user_id ? resetPassword : createLogin} style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn ghost"><KeyRound size={15} />{s.user_id ? '비밀번호 초기화' : '로그인 계정 만들기'}</button>
                </form>
              </div>
            )}
            <div className="panel" style={{ marginBottom: 0 }}>
              <h2>수강 반</h2>
              {!current.length ? <p className="muted small">수강 중인 반이 없습니다. 「반」 화면에서 추가하세요.</p> : (
                <table className="t"><tbody>
                  {current.map((e: any) => (
                    <tr key={e.id}>
                      <td><Link href={`/staff/classes/${e.classes?.id}`}><b>{e.classes?.name}</b></Link><div className="muted small">{e.classes?.schedule}</div></td>
                      <td className="r"><Link className="btn ghost sm" href={`/staff/attendance?date=${today}&class=${e.classes?.id}`}>출결</Link></td>
                    </tr>
                  ))}
                </tbody></table>
              )}
              {!!past.length && (
                <details style={{ marginTop: 10 }}><summary className="small">지난 반 {past.length}개</summary>
                  <table className="t"><tbody>{past.map((e: any) => <tr key={e.id}><td>{e.classes?.name}</td><td className="num small muted">{e.start_date} ~ {e.end_date}</td></tr>)}</tbody></table>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'attendance' && (
        <div className="panel flush">
          {!a.length ? <div className="empty">최근 90일 출결 기록이 없습니다.</div> : (
            <div className="scroll">
              <table className="t">
                <thead><tr><th>날짜</th><th>반</th><th>출결</th><th>등원</th><th>하원</th><th>메모</th></tr></thead>
                <tbody>
                  {a.map((x: any, i: number) => (
                    <tr key={i}>
                      <td className="num">{x.date.slice(5).replace('-', '/')}</td>
                      <td className="small">{x.classes?.name}</td>
                      <td><span className={'badge ' + STATUS_CLASS[x.status]}>{STATUS_LABEL[x.status]}</span></td>
                      <td className="num small">{x.check_in ? seoulDate(x.check_in, 'mdhm').split(' ')[1] : ''}</td>
                      <td className="num small">{x.check_out ? seoulDate(x.check_out, 'mdhm').split(' ')[1] : ''}</td>
                      <td className="small">{x.memo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'omr' && (
        <div className="panel flush">
          {!subs?.length ? <div className="empty">응시한 시험이 없습니다.</div> : (
            <div className="scroll">
              <table className="t">
                <thead><tr><th>날짜</th><th>시험</th><th>반</th><th className="r">점수</th></tr></thead>
                <tbody>
                  {subs.map((x: any) => (
                    <tr key={x.id}>
                      <td className="num">{seoulDate(x.submitted_at)}</td>
                      <td><Link href={`/staff/exams/${x.exams?.id}`}>{x.exams?.title}</Link>{x.attempt > 1 && <span className="badge"> {x.attempt}차</span>}</td>
                      <td className="small">{x.exams?.classes?.name}</td>
                      <td className="r num"><b>{pts(x.score, x.n)}</b> <span className="muted small">({x.score}/{x.n})</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'messages' && (
        <div className="panel flush">
          {!logs?.length ? <div className="empty">보낸 알림톡이 없습니다.</div> : (
            <div className="scroll">
              <table className="t">
                <thead><tr><th>시각</th><th>내용</th><th>결과</th></tr></thead>
                <tbody>
                  {logs.map((l: any) => (
                    <tr key={l.id}>
                      <td className="num small" style={{ whiteSpace: 'nowrap' }}>{seoulDate(l.sent_at, 'mdhm')}</td>
                      <td><div className="small"><b>{l.exams?.title ?? '알림톡'}</b> · {l.trigger === 'auto' ? '자동' : '수동'}</div>{l.body && <details><summary className="small">보낸 내용</summary><pre className="msg">{l.body}</pre></details>}</td>
                      <td><span className={'badge ' + (l.status === 'sent' ? 'good' : l.status === 'failed' ? 'bad' : '')}>{l.status === 'sent' ? '발송' : l.status === 'failed' ? '실패' : '건너뜀'}</span>{l.status !== 'sent' && <div className="small muted">{l.result}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
