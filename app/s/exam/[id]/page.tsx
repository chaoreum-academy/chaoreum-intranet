import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { pts } from '@/lib/omr/engine';
import { OmrSheet } from './OmrSheet';

export default async function TakeExam({ params }: { params: { id: string } }) {
  const me = await requireRole(['student']);
  const { data: exam } = await me.sb.from('exams').select('id, title, n_items, choices, is_open, allow_retake, opens_at, classes(name)').eq('id', params.id).maybeSingle();
  if (!exam) return <div className="card">시험을 찾을 수 없어요. 우리 반 시험이 아니거나 아직 열리지 않았어요. <Link href="/s">목록으로</Link></div>;
  const e: any = exam;
  const { data: sid } = await me.sb.rpc('my_student_id');
  const { data: mine } = await me.sb.from('submissions').select('score, n, attempt').eq('exam_id', e.id).eq('student_id', sid).order('attempt');
  const open = e.is_open && (!e.opens_at || new Date(e.opens_at) <= new Date());
  if ((mine?.length && !e.allow_retake) || !open) {
    const f = mine?.[0];
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="t1">{e.title}</div>
        {f ? <><div className="score">{pts(f.score, f.n)}<small> / 100</small></div><p className="muted">이미 제출했어요.</p></> : <p className="muted">지금은 풀 수 없는 시험이에요.</p>}
        <div className="row" style={{ justifyContent: 'center' }}>{f && <Link className="btn" href={`/s/report?exam=${e.id}`}>리포트 보기</Link>}<Link className="btn ghost" href="/s">목록으로</Link></div>
      </div>
    );
  }
  return (
    <>
      {!!mine?.length && <div className="flash ok">재시험이에요. ({(mine.length ?? 0) + 1}차) 점수 통계에는 1차 결과가 쓰여요.</div>}
      <OmrSheet id={e.id} title={e.title} n={e.n_items} choices={e.choices} cls={e.classes?.name ?? ''} />
    </>
  );
}
