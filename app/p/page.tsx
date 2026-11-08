import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { buildReport } from '@/lib/report';
import { ReportView } from '@/components/ReportView';
import { logout } from '../actions';

export default async function ParentHome({ searchParams }: { searchParams: { student?: string } }) {
  const me = await requireRole(['parent']);
  // RLS: 연결된 자녀만 보인다
  const { data: kids } = await me.sb.from('students').select('id, name, schools(name), grade').order('name');
  const list = kids ?? [];
  const current = list.find((k) => k.id === searchParams.student) ?? list[0];
  const data = current ? await buildReport(me, current.id) : null;
  return (
    <div className="m">
      <div className="mtop">
        <div className="who">{me.name}<span>학부모</span></div>
        <form action={logout}><button type="submit">로그아웃</button></form>
      </div>
      {list.length > 1 && (
        <nav className="mnav">{list.map((k) => <Link key={k.id} href={`/p?student=${k.id}`} className={k.id === current?.id ? 'on' : ''}>{k.name}</Link>)}</nav>
      )}
      {!current ? <div className="card">연결된 자녀가 없습니다. 학원 데스크에 문의해 주세요.</div> : (
        <>
          <h2>{current.name} 학생 학습 리포트</h2>
          {data && <ReportView data={data} />}
        </>
      )}
    </div>
  );
}
