'use client';
import { useState } from 'react';
import type { ReportData } from '@/lib/report';

/** 기존 Report.html 화면을 그대로 옮긴 학생·학부모 리포트 */
export function ReportView({ data, initial }: { data: ReportData; initial?: string }) {
  const start = Math.max(0, initial ? data.exams.findIndex((x) => x.id === initial) : data.exams.length - 1);
  const [i, setI] = useState(start < 0 ? data.exams.length - 1 : start);
  if (!data.exams.length) return <div className="card empty">{data.name} 학생은 아직 제출한 시험이 없어요.</div>;
  const x = data.exams[i];
  return (
    <>
      <select value={i} onChange={(e) => setI(Number(e.target.value))} style={{ width: '100%', fontSize: 16, padding: 10 }} aria-label="시험 선택">
        {data.exams.map((e, k) => <option key={e.id} value={k}>{e.date} · {e.title}</option>)}
      </select>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="score">{x.score}<small> / 100</small></div>
        <div className="muted small" style={{ textAlign: 'center' }}>{x.total}문항 중 {x.right}문항 정답 · {x.cls}</div>

        {!!x.areas.length && (<>
          <div className="sec">영역별 정답률</div>
          {x.areas.map((a) => (
            <div className="area" key={a.area}>
              <div className="top"><span>{a.area}{a.need && <span className="need">보완 필요</span>}</span><span className="num">{a.rate}%</span></div>
              <div className="track"><div className={'fill' + (a.need ? ' low' : '')} style={{ width: a.rate + '%' }} /></div>
            </div>
          ))}
        </>)}

        <div className="sec">문항별 결과</div>
        <div className="dots">{x.ox.map((o, k) => <div key={k} className={'dot ' + (o ? 'o' : 'x')} aria-label={`${k + 1}번 ${o ? '맞음' : '틀림'}`}>{k + 1}</div>)}</div>
        <div className="muted small" style={{ marginTop: 8 }}>초록 = 맞음, 빨강 = 틀림</div>

        <div className="sec">선생님 코멘트</div>
        <div className="comment">{x.comment.split('\n').map((l, k) => <p key={k}>{l}</p>)}</div>
      </div>
      {data.exams.length > 1 && (
        <div className="card">
          <div className="sec" style={{ marginTop: 0 }}>누적 점수 추이</div>
          <Trend exams={data.exams} />
        </div>
      )}
    </>
  );
}

function Trend({ exams }: { exams: ReportData['exams'] }) {
  const W = 448, H = 200, L = 34, R = 10, T = 14, B = 34, n = exams.length;
  const X = (k: number) => (n === 1 ? (L + W - R) / 2 : L + ((W - L - R) * k) / (n - 1));
  const Y = (v: number) => T + (H - T - B) * (1 - v / 100);
  const pts = exams.map((e, k) => [X(k), Y(e.score)]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="점수 추이">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#e6e9ee" />
          <text x={L - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="#8a93a3">{v}</text>
        </g>
      ))}
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#2b3e66" strokeWidth="2.5" />
      {pts.map((p, k) => (
        <g key={k}>
          <circle cx={p[0]} cy={p[1]} r="4.5" fill="#2b3e66" />
          {(n <= 8 || k % Math.ceil(n / 8) === 0 || k === n - 1) && <text x={p[0]} y={H - 12} textAnchor="middle" fontSize="11" fill="#5e6a80">{exams[k].date}</text>}
        </g>
      ))}
    </svg>
  );
}
