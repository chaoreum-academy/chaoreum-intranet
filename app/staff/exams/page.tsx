import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import { requireRole, STAFF } from '@/lib/auth';
import { Flash } from '@/components/Flash';
import { seoulDate } from '@/lib/ids';
import { createExam } from './actions';
import { branchScope } from '@/lib/branch';
import { KeyFileImport } from './KeyFileImport';

export default async function ExamsPage({ searchParams }: { searchParams: { class?: string; ok?: string; err?: string } }) {
  const me = await requireRole(STAFF);
  const scope = await branchScope(me);
  let cq = me.sb.from('classes').select('id, name, branches(name)').eq('active', true).order('name');
  if (scope.current) cq = cq.eq('branch_id', scope.current);
  const { data: classes } = await cq;
  let q = me.sb.from('exams').select('id, title, n_items, is_open, allow_retake, created_at, classes(id, name), submissions(attempt)').order('created_at', { ascending: false }).limit(200);
  if (searchParams.class) q = q.eq('class_id', searchParams.class);
  else if (scope.current) q = q.in('class_id', (classes ?? []).map((c: any) => c.id).concat('00000000-0000-0000-0000-000000000000'));
  const { data: exams } = await q;

  return (
    <>
      <div className="head">
        <div><h1>OMR 과제</h1><div className="sub">학생은 휴대폰으로 답을 고르고, 제출하는 순간 자동 채점됩니다.</div></div>
        <form className="row" method="get">
          <select name="class" defaultValue={searchParams.class ?? ''}>
            <option value="">전체 반</option>
            {(classes ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.branches?.name} {c.name}</option>)}
          </select>
          <button className="btn ghost">보기</button>
        </form>
      </div>
      <Flash sp={searchParams} />
      <details className="panel" open={!exams?.length}>
        <summary>새 시험 만들기</summary>
        {!classes?.length ? <p className="muted">담당 반이 없어 시험을 만들 수 없습니다.</p> : (
          <form action={createExam} style={{ marginTop: 14 }}>
            <div className="row">
              <label className="field">반
                <select name="class_id" required defaultValue={searchParams.class ?? ''}>
                  {(classes ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.branches?.name} {c.name}</option>)}
                </select>
              </label>
              <label className="field">시험명<input name="title" required placeholder="복습테스트 3회" size={18} /></label>
              <label className="field">선택지 수<select name="choices" defaultValue="5">{[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}지선다</option>)}</select></label>
              <label className="field">시작 일시 (비우면 바로)<input type="datetime-local" name="opens_at" /></label>
            </div>
            <div style={{ marginTop: 12 }}><KeyFileImport /></div>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="field" style={{ flex: 1, minWidth: 260 }}>정답 (①②③ 또는 숫자 31425)<input name="answers" placeholder="③①④②⑤" /></label>
              <label className="field">문항 수 (비우면 정답 개수)<input name="n_items" size={6} inputMode="numeric" /></label>
            </div>
            <label className="field" style={{ marginTop: 10 }}>학부모 문자 첫 문장 (잘함|보통|부족, 비워도 됨)
              <input name="guide" placeholder="아주 잘했어요!|조금만 더 힘내요.|복습이 꼭 필요해요." />
            </label>
            <label className="field" style={{ marginTop: 10 }}>문항정보 (기존 시트 '문항정보' 탭을 머리글째 붙여넣기 — 영역 분석·코멘트에 사용)
              <textarea name="items" placeholder={'번호\t정답\t영역\t핵심 개념\t보완 방법\n1\t③\t현대시\t화자와 정서\t정서를 한 문장으로 정리합니다.'} />
            </label>
            <div className="row" style={{ marginTop: 10 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="checkbox" name="is_open" /> 바로 열기</label>
              <SubmitButton pendingText="만드는 중…">시험 만들기</SubmitButton>
            </div>
          </form>
        )}
      </details>
      <div className="panel">
        {!exams?.length ? <div className="empty">아직 시험이 없습니다.</div> : (
          <div className="scroll">
            <table className="t">
              <thead><tr><th>만든 날</th><th>반</th><th>시험</th><th className="r">문항</th><th>상태</th><th className="r">제출</th></tr></thead>
              <tbody>
                {exams.map((e: any) => (
                  <tr key={e.id}>
                    <td className="num">{seoulDate(e.created_at)}</td>
                    <td>{e.classes?.name}</td>
                    <td><Link href={`/staff/exams/${e.id}`}><b>{e.title}</b></Link></td>
                    <td className="r num">{e.n_items}</td>
                    <td>{e.is_open ? <span className="badge good">열림</span> : <span className="badge">닫힘</span>}{e.allow_retake && <span className="badge navy"> 재시험</span>}</td>
                    <td className="r num">{(e.submissions ?? []).filter((s: any) => s.attempt === 1).length}명</td>
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
