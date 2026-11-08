import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import { Upload, UserPlus } from 'lucide-react';
import { requireRole, STAFF, BRANCH_ADMIN } from '@/lib/auth';
import { branchScope } from '@/lib/branch';
import { Flash } from '@/components/Flash';
import { Avatar } from '@/components/Avatar';
import { BulkAccounts } from '@/components/BulkAccounts';
import { addStudent } from './actions';

export const maxDuration = 60;
const STATUS: Record<string, [string, string]> = { active: ['재원', 'good'], paused: ['휴원', 'warn'], withdrawn: ['퇴원', ''] };

export default async function StudentsPage({ searchParams }: { searchParams: { q?: string; status?: string; cls?: string; ok?: string; err?: string } }) {
  const me = await requireRole(STAFF);
  const canEdit = BRANCH_ADMIN.includes(me.role);
  const scope = await branchScope(me);
  const status = searchParams.status || 'active';

  let query = me.sb.from('students')
    .select('id, student_no, name, grade, status, user_id, guardian_phone, branch_id, branches(name), schools(name), enrollments(end_date, class_id, classes(name))')
    .order('name').limit(1000);
  if (status !== 'all') query = query.eq('status', status);
  if (scope.current) query = query.eq('branch_id', scope.current);
  if (searchParams.q) {
    const q = searchParams.q.replace(/[%,()]/g, '').trim();
    query = query.or(`name.ilike.%${q}%,student_no.ilike.%${q}%,guardian_phone.ilike.%${q}%`);
  }
  let { data: students } = await query;
  let classQ = me.sb.from('classes').select('id, name').eq('active', true).order('name');
  if (scope.current) classQ = classQ.eq('branch_id', scope.current);
  const { data: classes } = await classQ;
  if (searchParams.cls) students = (students ?? []).filter((s: any) => (s.enrollments ?? []).some((e: any) => !e.end_date && e.class_id === searchParams.cls));
  const list = students ?? [];
  const noAccount = canEdit ? list.filter((s: any) => !s.user_id && s.student_no && s.status === 'active').length : 0;
  const link = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const all = { q: searchParams.q, status, cls: searchParams.cls, ...p };
    Object.entries(all).forEach(([k, v]) => { if (v) u.set(k, v); });
    return '/staff/students?' + u.toString();
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>학생 <span className="muted num" style={{ fontWeight: 500, fontSize: 16 }}>{list.length}명</span></h1>
          <div className="sub">{me.role === 'teacher' ? '담당 반·담임 학생만 보입니다.' : scope.current ? `${scope.branches.find((b) => b.id === scope.current)?.name} 학생입니다. 상단에서 지점을 바꿀 수 있습니다.` : '관리하는 모든 지점의 학생입니다.'}</div>
        </div>
        {canEdit && (
          <div className="row">
            <Link className="btn ghost" href="/staff/students/import"><Upload size={16} />엑셀·명단 가져오기</Link>
            <a className="btn" href="#new"><UserPlus size={16} />학생 등록</a>
          </div>
        )}
      </div>
      <Flash sp={searchParams} />

      {!list.length && !searchParams.q && status === 'active' && canEdit && (
        <div className="panel" style={{ textAlign: 'center', padding: '36px 20px' }}>
          <h2>아직 등록된 학생이 없습니다</h2>
          <p className="muted">맥가이나 구글 시트의 학생 명단을 엑셀로 내려받아 한 번에 가져오세요. 보호자 연락처와 반 배정까지 같이 됩니다.</p>
          <Link className="btn" href="/staff/students/import"><Upload size={16} />엑셀·명단 가져오기</Link>
        </div>
      )}

      {canEdit && <BulkAccounts count={noAccount} branchId={scope.current} />}

      <div className="panel flush">
        <div className="phead">
          <div className="pills">
            {[['active', '재원'], ['paused', '휴원'], ['withdrawn', '퇴원'], ['all', '전체']].map(([k, v]) => (
              <Link key={k} href={link({ status: k })} className={status === k ? 'on' : ''}>{v}</Link>
            ))}
          </div>
          <form className="row" method="get" action="/staff/students">
            <input type="hidden" name="status" value={status} />
            <select name="cls" defaultValue={searchParams.cls ?? ''} aria-label="반">
              <option value="">모든 반</option>
              {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input name="q" placeholder="이름·학번·보호자 번호" defaultValue={searchParams.q} size={16} />
            <button className="btn ghost">검색</button>
          </form>
        </div>
        {!list.length ? <div className="empty">조건에 맞는 학생이 없습니다.</div> : (
          <div className="scroll">
            <table className="t">
              <thead><tr><th>학생</th><th>학번</th><th>수강 반</th><th>보호자 연락처</th>{!scope.current && me.role !== 'teacher' && <th>지점</th>}<th>상태</th>{canEdit && <th>로그인</th>}</tr></thead>
              <tbody>
                {list.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/staff/students/${s.id}`} className="person">
                        <Avatar name={s.name} />
                        <span><b>{s.name}</b><span className="meta">{s.schools?.name ?? ''} {s.grade ? s.grade + '학년' : ''}</span></span>
                      </Link>
                    </td>
                    <td className="num small">{s.student_no ?? <span className="muted">-</span>}</td>
                    <td><div className="chips">{(s.enrollments ?? []).filter((e: any) => !e.end_date).map((e: any, i: number) => <span key={i} className="chip">{e.classes?.name}</span>)}</div></td>
                    <td className="num small">{s.guardian_phone ?? <span className="badge warn">없음</span>}</td>
                    {!scope.current && me.role !== 'teacher' && <td className="small">{s.branches?.name}</td>}
                    <td><span className={'badge ' + STATUS[s.status][1]}>{STATUS[s.status][0]}</span></td>
                    {canEdit && <td>{s.user_id ? <span className="badge good">있음</span> : <span className="badge">없음</span>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="panel" id="new">
          <h2>학생 한 명 등록</h2>
          <form action={addStudent}>
            <div className="row">
              <label className="field">이름 *<input name="name" required size={8} /></label>
              <label className="field">학번<input name="student_no" size={7} placeholder="03791" /></label>
              <label className="field">학교<input name="school" size={8} placeholder="광북고" /></label>
              <label className="field">학년<input name="grade" size={3} placeholder="1" /></label>
              <label className="field">지점 *
                <select name="branch_id" required defaultValue={scope.current ?? ''}>{scope.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </label>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="field">학생 연락처<input name="phone" size={13} inputMode="tel" /></label>
              <label className="field">보호자<input name="guardian_name" size={8} placeholder="어머니" /></label>
              <label className="field">보호자 연락처<input name="guardian_phone" size={13} inputMode="tel" /></label>
              <SubmitButton>등록</SubmitButton>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
