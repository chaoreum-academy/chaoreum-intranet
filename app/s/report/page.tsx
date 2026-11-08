import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { buildReport } from '@/lib/report';
import { ReportView } from '@/components/ReportView';

export default async function MyReport({ searchParams }: { searchParams: { exam?: string } }) {
  const me = await requireRole(['student']);
  const { data: sid } = await me.sb.rpc('my_student_id');
  const data = sid ? await buildReport(me, sid as string) : null;
  return (
    <>
      <nav className="mnav"><Link href="/s">시험</Link><Link href="/s/report" className="on">내 리포트</Link></nav>
      {data ? <ReportView data={data} initial={searchParams.exam} /> : <div className="card">학생 정보가 연결되지 않았어요. 데스크에 문의해 주세요.</div>}
    </>
  );
}
