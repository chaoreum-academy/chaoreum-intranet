'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { CIRCLE, pts } from '@/lib/omr/engine';
import { submitExam, type SubmitResult } from './actions';
import { PhotoScan } from './PhotoScan';
import type { Flag } from '@/lib/omr/scan';

export function OmrSheet({ id, title, n, choices, cls }: { id: string; title: string; n: number; choices: number; cls: string }) {
  const [ans, setAns] = useState<number[]>(() => Array(n).fill(0));
  const [flags, setFlags] = useState<Flag[] | null>(null); // 사진 인식 후 '확인 필요' 문항 표시
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [pending, start] = useTransition();
  const left = ans.filter((a) => !a).length;

  if (result?.ok) {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="muted">{title}</div>
        <div className="score">{pts(result.score, result.n)}<small> / 100</small></div>
        <div className="muted small">{result.n}문항 중 {result.score}문항 정답</div>
        <p style={{ marginTop: 16 }}>{result.wrong.length ? <>틀린 문항: <b className="num">{result.wrong.join(', ')}번</b></> : '전 문항 정답이에요!'}</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <Link className="btn" href={`/s/report?exam=${id}`}>리포트 보기</Link>
          <Link className="btn ghost" href="/s">시험 목록</Link>
        </div>
      </div>
    );
  }

  const send = () => {
    const unsure = ans.map((_, q) => (flags?.[q] === 'unsure' || flags?.[q] === 'multi' ? q + 1 : 0)).filter(Boolean);
    if (unsure.length && !confirm(`사진에서 확실히 읽지 못한 문항이 있어요: ${unsure.join(', ')}번\n확인하지 않고 제출할까요?`)) return;
    if (left && !confirm(`아직 ${left}문항을 고르지 않았어요. 이대로 제출할까요?`)) return;
    if (!left && !confirm('제출하면 고칠 수 없어요. 제출할까요?')) return;
    start(async () => setResult(await submitExam(id, ans)));
  };

  const needCheck = (q: number) => flags?.[q] === 'unsure' || flags?.[q] === 'multi';

  return (
    <>
      <PhotoScan examId={id} n={n} choices={choices} onResult={(a, f) => { setAns(a); setFlags(f); }} />
      <div className="omr" role="group" aria-label={title + ' 답안지'}>
        <div className="bar">{title}<span>{cls} · {n}문항</span></div>
        {ans.map((a, q) => (
          <div className={'q' + (needCheck(q) ? ' flag' : '')} key={q}>
            <div className="no">{q + 1}{needCheck(q) && <small>확인</small>}</div>
            <div className="opts" role="radiogroup" aria-label={`${q + 1}번`}>
              {Array.from({ length: choices }, (_, c) => (
                <button
                  key={c} type="button" role="radio" aria-checked={a === c + 1} aria-label={`${q + 1}번 ${c + 1}`}
                  className={'bub' + (a === c + 1 ? ' on' : '')}
                  onClick={() => {
                    setAns((prev) => prev.map((v, k) => (k === q ? (v === c + 1 ? 0 : c + 1) : v)));
                    if (needCheck(q)) setFlags((f) => f && f.map((x, k): Flag => (k === q ? 'ok' : x)));
                  }}
                >{CIRCLE.charAt(c)}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="omr-foot">
        {result && !result.ok && <div className="flash err">{result.msg}</div>}
        <div className="left">{left ? `${left}문항 남음` : '모두 골랐어요'}</div>
        <button className="btn" onClick={send} disabled={pending}>{pending ? '채점 중…' : '제출하기'}</button>
      </div>
    </>
  );
}
