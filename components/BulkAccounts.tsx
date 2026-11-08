'use client';
import { useState, useTransition } from 'react';
import { createLoginsBulk, type BulkResult } from '@/app/staff/students/actions';

/** 계정 없는 학생 일괄 생성 → 아이디·임시 비밀번호 표 (인쇄·엑셀 저장) */
export function BulkAccounts({ count, branchId }: { count: number; branchId: string | null }) {
  const [made, setMade] = useState<BulkResult['made']>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [remaining, setRemaining] = useState(count);
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    const r = await createLoginsBulk(branchId);
    setMade((m) => m.concat(r.made)); setFailed((f) => f.concat(r.failed)); setRemaining(r.remaining);
  });
  const csv = () => {
    const text = '\uFEFF학번,이름,임시 비밀번호\n' + made.map((m) => `${m.no},${m.name},${m.password}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = '학생계정_임시비밀번호.csv'; a.click();
  };
  if (!count && !made.length) return null;
  return (
    <div className="panel">
      <div className="phead">
        <h2>학생 로그인 계정</h2>
        <div className="row">
          {remaining > 0 && <button className="btn" onClick={run} disabled={pending}>{pending ? '만드는 중…' : `계정 없는 ${remaining}명 ${remaining > 40 ? '중 40명 ' : ''}만들기`}</button>}
          {!!made.length && <><button className="btn ghost" onClick={csv}>엑셀(CSV) 저장</button><button className="btn ghost" onClick={() => window.print()}>인쇄</button></>}
        </div>
      </div>
      {!made.length ? <p className="muted small" style={{ margin: 0 }}>학생은 학번과 임시 비밀번호로 로그인합니다. 만든 뒤 나오는 표를 저장하거나 인쇄해서 학생에게 나눠 주세요. 이 표는 화면을 벗어나면 다시 볼 수 없습니다.</p> : (
        <>
          <div className="flash ok">{made.length}명 계정을 만들었습니다. 지금 저장하거나 인쇄해 두세요.</div>
          <div className="scroll" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="t"><thead><tr><th>학번</th><th>이름</th><th>임시 비밀번호</th></tr></thead>
              <tbody>{made.map((m) => <tr key={m.no}><td className="num">{m.no}</td><td>{m.name}</td><td className="num"><b>{m.password}</b></td></tr>)}</tbody></table>
          </div>
        </>
      )}
      {!!failed.length && <div className="flash err" style={{ marginTop: 12 }}>만들지 못한 {failed.length}명{'\n'}{failed.slice(0, 20).join('\n')}</div>}
    </div>
  );
}
