import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import { requireRole, STAFF, myBranches } from '@/lib/auth';
import { Flash } from '@/components/Flash';
import { addClass } from './actions';
import { branchScope } from '@/lib/branch';

export default async function ClassesPage({ searchParams }: { searchParams: { ok?: string; err?: string; all?: string } }) {
  const me = await requireRole(STAFF);
  const canCreate = me.role === 'hq_admin' || me.role === 'branch_manager';
  const branches = canCreate ? await myBranches(me) : [];
  let q = me.sb.from('classes')
    .select('id, name, subject, schedule, grade, active, branches(name, sort), class_teachers(profiles(display_name)), enrollments(id, end_date)')
    .order('name');
  if (!searchParams.all) q = q.eq('active', true);
  const scope = await branchScope(me);
  if (scope.current) q = q.eq('branch_id', scope.current);
  const { data: classes } = await q;
  const list = (classes ?? []).sort((a: any, b: any) => (a.branches?.sort ?? 0) - (b.branches?.sort ?? 0) || a.name.localeCompare(b.name, 'ko'));

  return (
    <>
      <div className="head">
        <div><h1>반</h1><div className="sub">{me.role === 'teacher' ? '담당 반만 보입니다.' : '관리하는 지점의 반입니다.'}</div></div>
        <Link className="btn ghost" href={searchParams.all ? '/staff/classes' : '/staff/classes?all=1'}>{searchParams.all ? '운영 중인 반만' : '종료된 반 포함'}</Link>
      </div>
      <Flash sp={searchParams} />
      {canCreate && (
        <div className="panel">
          <h2>새 반 만들기</h2>
          <form className="row" action={addClass}>
            <label className="field">지점<select name="branch_id" required>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="field">반 이름<input name="name" required placeholder="광북1A" size={10} /></label>
            <label className="field">과목<input name="subject" placeholder="국어" size={6} /></label>
            <label className="field">학년<input name="grade" placeholder="1" size={3} /></label>
            <label className="field">수업 시간<input name="schedule" placeholder="토 10시" size={10} /></label>
            <SubmitButton>만들기</SubmitButton>
          </form>
        </div>
      )}
      <div className="panel">
        {!list.length ? <div className="empty">{canCreate ? '아직 반이 없습니다. 위에서 첫 반을 만들어 보세요.' : '배정된 반이 없습니다. 지점 실장에게 배정을 요청하세요.'}</div> : (
          <div className="scroll">
            <table className="t">
              <thead><tr><th>지점</th><th>반</th><th>과목</th><th>수업 시간</th><th>강사</th><th className="r">학생</th></tr></thead>
              <tbody>
                {list.map((c: any) => (
                  <tr key={c.id}>
                    <td>{c.branches?.name}</td>
                    <td><Link href={`/staff/classes/${c.id}`}><b>{c.name}</b></Link>{!c.active && <span className="badge"> 종료</span>}</td>
                    <td>{c.subject}</td>
                    <td>{c.schedule}</td>
                    <td>{(c.class_teachers ?? []).map((t: any) => t.profiles?.display_name).filter(Boolean).join(', ') || <span className="muted">미배정</span>}</td>
                    <td className="r num">{(c.enrollments ?? []).filter((e: any) => !e.end_date).length}명</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
