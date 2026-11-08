import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { pts } from '@/lib/omr/engine';

export default async function StudentHome() {
  const me = await requireRole(['student']);
  const { data: sid } = await me.sb.rpc('my_student_id');
  // RLS: 지금 다니는 반의 '열린' 시험 + 내가 이미 본 시험만 보인다
  const { data: exams } = await me.sb.from('exams')
    .select('id, title, n_items, is_open, allow_retake, opens_at, created_at, classes(name), submissions(attempt, score, n, student_id)')
    .order('created_at', { ascending: false }).limit(60);
  const rows = (exams ?? []).map((e: any) => {
    const mine = (e.submissions ?? []).filter((s: any) => s.student_id === sid);
    const first = mine.find((s: any) => s.attempt === 1);
    const canTake = e.is_open && (!e.opens_at || new Date(e.opens_at) <= new Date()) && (!mine.length || e.allow_retake);
    return { ...e, first, tries: mine.length, canTake };
  });
  const todo = rows.filter((r) => r.canTake && !r.first);
  const rest = rows.filter((r) => !(r.canTake && !r.first));

  return (
    <>
      <nav className="mnav"><Link href="/s" className="on">시험</Link><Link href="/s/report">내 리포트</Link></nav>
      <h2>풀어야 할 시험 {todo.length ? <span className="num">{todo.length}</span> : ''}</h2>
      {!todo.length && <div className="card muted">지금 풀 시험이 없어요.</div>}
      {todo.map((e) => (
        <Link key={e.id} href={`/s/exam/${e.id}`} className="card exam-row">
          <div><div className="t1">{e.title}</div><div className="t2">{e.classes?.name} · {e.n_items}문항</div></div>
          <span className="btn">풀기</span>
        </Link>
      ))}
      {!!rest.length && <h2 style={{ marginTop: 24 }}>지난 시험</h2>}
      {rest.map((e) => (
        <div key={e.id} className="card exam-row">
          <div><div className="t1">{e.title}</div><div className="t2">{e.classes?.name}</div></div>
          <div style={{ textAlign: 'right' }}>
            {e.first ? <Link href={`/s/report?exam=${e.id}`}><b className="num">{pts(e.first.score, e.first.n)}점</b></Link> : <span className="badge">마감</span>}
            {e.canTake && <div><Link href={`/s/exam/${e.id}`} className="small">다시 풀기</Link></div>}
          </div>
        </div>
      ))}
    </>
  );
}
