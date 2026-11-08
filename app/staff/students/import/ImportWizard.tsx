'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { importStudentsJson, type ImportRow, type ImportResult } from '../actions';
import { FIELDS, LABELS, detect, parseClassCell, matchBranch, type Field } from '@/lib/importDetect';

export function ImportWizard({ branches, defaultBranch, canCreateClasses }: { branches: { id: string; name: string }[]; defaultBranch: string | null; canCreateClasses: boolean }) {
  const [table, setTable] = useState<string[][] | null>(null);
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState('');
  const [branch, setBranch] = useState(defaultBranch ?? branches[0]?.id ?? '');
  const [createClasses, setCreateClasses] = useState(canCreateClasses);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const [override, setOverride] = useState<Partial<Record<Field, number>>>({});

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' }) as string[][];
    setTable(rows.map((r) => r.map((c) => String(c ?? '')))); setSource(`${f.name} · 첫 번째 시트`); setResult(null); setOverride({});
  };
  const onPaste = () => {
    setTable(paste.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t')));
    setSource('붙여넣은 표'); setResult(null); setOverride({});
  };

  const auto = table ? detect(table) : null;
  const found = auto ? { head: auto.head, map: { ...auto.map, ...override } as Partial<Record<Field, number>> } : null;
  if (found) (Object.keys(found.map) as Field[]).forEach((k) => { if ((found.map[k] ?? -1) < 0) delete found.map[k]; });
  const cols = found ? Object.keys(found.map) : [];
  const headers = found && table ? table[found.head] : [];
  const rows: ImportRow[] = [];
  const dupNos: string[] = [];
  const unknownBranch = new Set<string>();
  const bname = (id: string) => branches.find((b) => b.id === id)?.name ?? '';
  if (table && found) {
    const seen = new Set<string>();
    const get = (r: string[], k: Field) => (found.map[k] !== undefined ? String(r[found.map[k]!] ?? '').trim() : '');
    for (const r of table.slice(found.head + 1)) {
      const name = get(r, 'name');
      if (!name) continue;
      const no = get(r, 'student_no').replace(/\.0$/, '');
      if (no && seen.has(no)) { dupNos.push(no); continue; }
      if (no) seen.add(no);
      const parsed = parseClassCell(get(r, 'classes')).map((c) => ({ branch_id: matchBranch(c.branchToken, branches) ?? '', name: c.name, schedule: c.schedule, token: c.branchToken }));
      parsed.filter((c) => c.token && !c.branch_id).forEach((c) => unknownBranch.add(c.token!));
      rows.push({
        student_no: no, name, school: get(r, 'school'), grade: get(r, 'grade'), phone: get(r, 'phone'),
        guardian_name: get(r, 'guardian_name'), guardian_phone: get(r, 'guardian_phone'),
        branch_id: parsed.find((c) => c.branch_id)?.branch_id ?? '',
        classes: parsed.map(({ branch_id, name, schedule }) => ({ branch_id, name, schedule })),
      });
    }
  }
  const noPhone = rows.filter((r) => !r.guardian_phone).length;
  const noNo = rows.filter((r) => !r.student_no).length;
  const noBranch = rows.filter((r) => !r.branch_id).length;
  const autoBranch = rows.length - noBranch;

  const commit = () => start(async () => setResult(await importStudentsJson({ branch_id: branch, createClasses, cols, rows })));

  if (result?.ok) {
    return (
      <div className="panel">
        <h2>가져오기 완료</h2>
        <div className="flash ok">{result.message}</div>
        {!!result.failed.length && <div className="flash err">확인이 필요한 {result.failed.length}건{'\n'}{result.failed.slice(0, 30).join('\n')}</div>}
        <div className="row"><Link className="btn" href="/staff/students">학생 목록 보기</Link><button className="btn ghost" onClick={() => { setTable(null); setResult(null); setPaste(''); }}>다른 파일 가져오기</button></div>
      </div>
    );
  }

  return (
    <>
      <div className="steps"><span className={!table ? 'on' : ''}>1. 파일 고르기</span><span className={table ? 'on' : ''}>2. 확인하고 가져오기</span></div>
      {!table ? (
        <div className="grid2">
          <div className="panel">
            <h2>엑셀·CSV 파일</h2>
            <p className="muted small" style={{ marginTop: 0 }}>맥가이에서 내려받은 엑셀이나 구글 시트를 엑셀로 저장한 파일을 고르세요. 첫 번째 시트를 읽습니다.</p>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          <div className="panel">
            <h2>복사해서 붙여넣기</h2>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'시트에서 머리글 줄까지 함께 복사해 붙여넣으세요.\n학번\t이름\t학교\t학년\t보호자연락처\t반'} />
            <button className="btn" style={{ marginTop: 8 }} disabled={!paste.trim()} onClick={onPaste}>읽기</button>
          </div>
        </div>
      ) : !found ? (
        <div className="panel">
          <div className="flash err">머리글을 찾지 못했습니다. 첫 줄 근처에 「이름」(또는 학생이름·성명) 칸이 있어야 합니다.</div>
          <button className="btn ghost" onClick={() => setTable(null)}>다시 고르기</button>
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="phead">
              <h2>{source}에서 학생 {rows.length}명을 찾았습니다</h2>
              <button className="btn ghost sm" onClick={() => setTable(null)}>다시 고르기</button>
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>각 정보가 엑셀의 어느 칸인지 확인하세요. 틀렸거나 「없음」인데 칸이 있다면 직접 고르면 됩니다.</p>
            <div className="row" style={{ marginBottom: 14 }}>
              {FIELDS.map((k) => (
                <label key={k} className="field" style={{ minWidth: 120 }}>
                  <span>{LABELS[k]}{k === 'name' ? ' *' : ''} {found.map[k] !== undefined ? <span className="badge good">연결</span> : <span className="badge">없음</span>}</span>
                  <select value={found.map[k] ?? -1} onChange={(e) => setOverride((o) => ({ ...o, [k]: Number(e.target.value) }))}>
                    <option value={-1}>— 없음 —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{String(h || `(${i + 1}번째 칸)`).slice(0, 20)}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {cols.includes('classes') && autoBranch > 0 && <div className="flash ok">반 이름의 [지점]을 읽어 {autoBranch}명의 지점을 자동으로 정했습니다.{noBranch ? ` 나머지 ${noBranch}명은 아래 「기본 지점」으로 등록됩니다.` : ''}</div>}
            {unknownBranch.size > 0 && <div className="flash err">이 지점 이름은 알아보지 못했습니다: {Array.from(unknownBranch).join(', ')} → 해당 학생은 기본 지점으로 등록됩니다. 지점 이름이 다르면 알려 주세요.</div>}
            {(noNo > 0 || noPhone > 0 || dupNos.length > 0) && (
              <div className="flash info">
                {noNo > 0 && `학번 없는 학생 ${noNo}명은 매번 새로 등록됩니다. 학번이 있으면 같은 학생 정보만 고칩니다.\n`}
                {noPhone > 0 && `보호자 연락처가 없는 ${noPhone}명에게는 알림톡을 보낼 수 없습니다. 나중에 학생 카드에서 넣어도 됩니다.\n`}
                {dupNos.length > 0 && `파일 안에서 중복된 학번 ${dupNos.length}개는 첫 줄만 반영합니다: ${dupNos.slice(0, 8).join(', ')}`}
              </div>
            )}
            <div className="scroll" style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              <table className="t">
                <thead><tr><th>등록 지점</th>{FIELDS.filter((k) => cols.includes(k)).map((k) => <th key={k}>{LABELS[k]}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i}><td className="small">{r.branch_id ? bname(r.branch_id) : <span className="muted">기본: {bname(branch)}</span>}</td>{FIELDS.filter((k) => cols.includes(k)).map((k) => <td key={k} className="small">{k === 'classes' ? <div className="chips">{r.classes.map((c, j) => <span key={j} className="chip">{c.name}{c.schedule ? ` · ${c.schedule}` : ''}</span>)}</div> : (r as any)[k]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 100 && <p className="muted small">처음 100명만 미리 보여 줍니다.</p>}
            {cols.includes('classes') && <p className="muted small">한 칸에 반이 여러 개면 쉼표(,)나 줄바꿈으로 나뉘어 있으면 각각 배정됩니다.</p>}
          </div>
          <div className="panel">
            <div className="row" style={{ alignItems: 'center' }}>
              <label className="field">{autoBranch ? '반에 지점이 없을 때 기본 지점' : '등록할 지점'}
                <select value={branch} onChange={(e) => setBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </label>
              {cols.includes('classes') && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, marginTop: 18 }}>
                  <input type="checkbox" checked={createClasses} disabled={!canCreateClasses} onChange={(e) => setCreateClasses(e.target.checked)} /> 없는 반은 새로 만들기
                </label>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn" disabled={pending || !rows.length || !branch} onClick={commit}>{pending ? '가져오는 중…' : `${rows.length}명 가져오기`}</button>
            </div>
            {result && !result.ok && <div className="flash err" style={{ marginTop: 12, marginBottom: 0 }}>{result.message}</div>}
            <p className="muted small" style={{ marginBottom: 0 }}>같은 학번이 이미 있으면 파일에 적힌 칸만 고치고(빈 칸으로 지우지 않음), 없으면 새로 등록합니다. 지점은 바뀌지 않습니다.</p>
          </div>
        </>
      )}
    </>
  );
}
