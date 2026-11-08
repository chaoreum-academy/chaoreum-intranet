import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole, STAFF, BRANCH_ADMIN } from '@/lib/auth';
import { Flash } from '@/components/Flash';
import { seoulDate } from '@/lib/ids';
import { addTeacher, removeTeacher, enroll, endEnrollment } from '../actions';

export default async function ClassDetail({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; err?: string } }) {
  const me = await requireRole(STAFF);
  const { data: c } = await me.sb.from('classes')
    .select('id, name, subject, schedule, branch_id, branches(name), class_teachers(user_id, role, profiles(display_name)), enrollments(id, start_date, end_date, students(id, name, student_no, grade, schools(name)))')
    .eq('id', params.id).maybeSingle();
  if (!c) notFound();
  const cls: any = c;
  const canLead = me.role === 'hq_admin' || me.role === 'branch_manager';
  const canEnroll = BRANCH_ADMIN.includes(me.role);

  const current = (cls.enrollments ?? []).filter((e: any) => !e.end_date).sort((a: any, b: any) => a.students?.name.localeCompare(b.students?.name, 'ko'));
  const past = (cls.enrollments ?? []).filter((e: any) => e.end_date);

  let teachers: any[] = [];
  let candidates: any[] = [];
  if (canLead) {
    const { data } = await me.sb.from('profiles').select('id, display_name, role').in('role', ['teacher', 'branch_manager', 'hq_admin']).eq('active', true).order('display_name');
    teachers = data ?? [];
  }
  if (canEnroll) {
    const enrolled = new Set(current.map((e: any) => e.students?.id));
    const { data } = await me.sb.from('students').select('id, name, student_no, grade, schools(name)').eq('branch_id', cls.branch_id).eq('status', 'active').order('name').limit(1000);
    candidates = (data ?? []).filter((s) => !enrolled.has(s.id));
  }

  return (
    <>
      <div className="head">
        <div>
          <div className="crumb"><Link href="/staff/classes">반</Link></div>
          <h1>{cls.name}</h1>
          <div className="sub">{cls.branches?.name} {cls.subject ? '· ' + cls.subject : ''} {cls.schedule ? '· ' + cls.schedule : ''}</div>
        </div>
        <Link className="btn" href={`/staff/exams?class=${cls.id}`}>이 반 OMR 시험</Link>
      </div>
      <Flash sp={searchParams} />
      <div className="grid2">
        <div className="panel">
          <h2>강사</h2>
          {!(cls.class_teachers ?? []).length && <p className="muted">아직 배정된 강사가 없습니다.</p>}
          <table className="t"><tbody>
            {(cls.class_teachers ?? []).map((t: any) => (
              <tr key={t.user_id}>
                <td>{t.profiles?.display_name}</td>
                <td><span className="badge navy">{t.role === 'main' ? '담당' : '보조'}</span></td>
                <td className="r">{canLead && (
                  <form action={removeTeacher}><input type="hidden" name="class_id" value={cls.id} /><input type="hidden" name="user_id" value={t.user_id} /><button className="btn danger sm">해제</button></form>
                )}</td>
              </tr>
            ))}
          </tbody></table>
          {canLead && (
            <form className="row" action={addTeacher} style={{ marginTop: 12 }}>
              <input type="hidden" name="class_id" value={cls.id} />
              <select name="user_id" required>{teachers.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}</select>
              <select name="role"><option value="main">담당</option><option value="assistant">보조</option></select>
              <button className="btn">배정</button>
            </form>
          )}
        </div>
        <div className="panel">
          <h2>학생 추가</h2>
          {canEnroll ? (
            candidates.length ? (
              <form action={enroll}>
                <input type="hidden" name="class_id" value={cls.id} />
                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px' }}>
                  {candidates.map((s) => (
                    <label key={s.id} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 14 }}>
                      <input type="checkbox" name="student_id" value={s.id} />
                      <span>{s.name}</span><span className="muted small num">{s.student_no} {s.schools?.name} {s.grade ? s.grade + '학년' : ''}</span>
                    </label>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label className="field">수강 시작일<input type="date" name="start_date" /></label>
                  <SubmitButton>선택한 학생 추가</SubmitButton>
                </div>
              </form>
            ) : <p className="muted">이 지점의 재원생이 모두 이 반에 있거나, 등록된 학생이 없습니다.</p>
          ) : <p className="muted">학생 배정은 지점 실장·데스크가 합니다.</p>}
        </div>
      </div>
      <div className="panel">
        <h2>수강 중 <span className="muted small num">{current.length}명</span></h2>
        {!current.length ? <div className="empty">아직 학생이 없습니다.</div> : (
          <table className="t">
            <thead><tr><th>이름</th><th>학번</th><th>학교·학년</th><th>시작일</th><th></th></tr></thead>
            <tbody>
              {current.map((e: any) => (
                <tr key={e.id}>
                  <td><b>{e.students?.name}</b></td>
                  <td className="num">{e.students?.student_no}</td>
                  <td>{e.students?.schools?.name} {e.students?.grade ? e.students.grade + '학년' : ''}</td>
                  <td className="num">{e.start_date}</td>
                  <td className="r">{canEnroll && (
                    <form action={endEnrollment}><input type="hidden" name="class_id" value={cls.id} /><input type="hidden" name="id" value={e.id} /><button className="btn danger sm">수강 종료</button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!!past.length && (
          <details style={{ marginTop: 14 }}>
            <summary>지난 수강생 {past.length}명</summary>
            <table className="t" style={{ marginTop: 8 }}><tbody>
              {past.map((e: any) => <tr key={e.id}><td>{e.students?.name}</td><td className="num muted">{e.start_date} ~ {e.end_date}</td></tr>)}
            </tbody></table>
          </details>
        )}
      </div>
    </>
  );
}
