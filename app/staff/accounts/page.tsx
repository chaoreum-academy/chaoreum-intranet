import { requireRole, BRANCH_ADMIN, ROLE_LABEL, type Role } from '@/lib/auth';
import { Flash } from '@/components/Flash';
import { createStaff, setStaffActive, createParent, renameStaff } from './actions';

export default async function AccountsPage({ searchParams }: { searchParams: { ok?: string; err?: string } }) {
  const me = await requireRole(BRANCH_ADMIN);
  const isHq = me.role === 'hq_admin';
  const [{ data: staff }, { data: branches }] = await Promise.all([
    me.sb.from('profiles').select('id, display_name, role, active, staff_branches(branches(name))').in('role', ['hq_admin', 'branch_manager', 'desk', 'teacher']).order('display_name'),
    me.sb.from('branches').select('id, name').order('sort'),
  ]);

  return (
    <>
      <div className="head"><div><h1>계정</h1><div className="sub">임시 비밀번호는 만든 직후 한 번만 보입니다. 첫 로그인 후 바꾸도록 안내하세요.</div></div></div>
      <Flash sp={searchParams} />
      <div className="grid2">
        {isHq && (
          <div className="panel">
            <h2>직원 계정 만들기</h2>
            <form action={createStaff}>
              <div className="row">
                <label className="field">이름<input name="name" required size={8} /></label>
                <label className="field">이메일<input name="email" type="email" required /></label>
                <label className="field">역할
                  <select name="role" defaultValue="teacher">
                    {(['teacher', 'desk', 'branch_manager', 'hq_admin'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </label>
              </div>
              <div className="field" style={{ marginTop: 10 }}>담당 지점 (실장·데스크는 필수, 강사는 반 배정으로 권한이 정해짐)
                <div className="row">{(branches ?? []).map((b) => (
                  <label key={b.id} style={{ display: 'flex', gap: 4, color: 'var(--ink)' }}><input type="checkbox" name="branch_id" value={b.id} />{b.name}</label>
                ))}</div>
              </div>
              <button className="btn" style={{ marginTop: 12 }}>만들기</button>
            </form>
          </div>
        )}
        <div className="panel">
          <h2>학부모 계정 만들기 · 자녀 연결</h2>
          <form action={createParent}>
            <div className="row">
              <label className="field">자녀 학번<input name="student_no" required size={7} /></label>
              <label className="field">학부모 이름<input name="name" required size={8} /></label>
              <label className="field">관계<input name="relation" placeholder="모" size={4} /></label>
            </div>
            <label className="field" style={{ marginTop: 10 }}>학부모 이메일<input name="email" type="email" required /></label>
            <button className="btn" style={{ marginTop: 12 }}>만들기 / 연결</button>
            <p className="muted small">이미 계정이 있는 학부모(형제)는 같은 이메일을 넣으면 자녀만 추가로 연결됩니다.</p>
          </form>
        </div>
      </div>
      <div className="panel">
        <h2>직원</h2>
        <p className="muted small" style={{ marginTop: -6 }}>이름은 학부모 알림톡의 「담당 강사 ○○○」에 그대로 들어갑니다.</p>
        <table className="t">
          <thead><tr><th>이름</th><th>역할</th><th>지점</th><th>상태</th></tr></thead>
          <tbody>
            {(staff ?? []).map((s: any) => (
              <tr key={s.id}>
                <td>{isHq ? (
                  <form action={renameStaff} className="row"><input type="hidden" name="id" value={s.id} /><input name="name" defaultValue={s.display_name} size={10} aria-label="이름" /><button className="btn ghost sm">이름 저장</button></form>
                ) : <b>{s.display_name}</b>}</td>
                <td>{ROLE_LABEL[s.role as Role]}</td>
                <td>{(s.staff_branches ?? []).map((x: any) => x.branches?.name).join(', ') || <span className="muted">-</span>}</td>
                <td>{isHq && s.id !== me.userId ? (
                  <form action={setStaffActive}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={String(!s.active)} />
                    <button className={s.active ? 'btn ghost sm' : 'btn sm'}>{s.active ? '사용 중 · 중지하기' : '중지됨 · 다시 쓰기'}</button></form>
                ) : <span className={'badge ' + (s.active ? 'good' : '')}>{s.active ? '사용 중' : '중지'}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
