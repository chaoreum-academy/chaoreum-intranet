import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole, STAFF } from '@/lib/auth';
import { sheetLayout, sheetSvg } from '@/lib/omr/sheet';
import { PrintButton } from './PrintButton';

/** 시험별 OMR 답안지 인쇄 화면 (A4). 학생은 여기에 표시하고 휴대폰으로 찍어 제출한다 */
export default async function PrintOmr({ params }: { params: { id: string } }) {
  const me = await requireRole(STAFF);
  const { data: exam } = await me.sb.from('exams').select('id, title, n_items, choices, classes(name, branches(name))').eq('id', params.id).maybeSingle();
  if (!exam) notFound();
  const e: any = exam;
  const layout = sheetLayout(e.n_items, e.choices);
  const sub = `${e.classes?.branches?.name ?? ''} ${e.classes?.name ?? ''} · ${e.n_items}문항 · ${e.choices}지선다`.trim();

  return (
    <div className="print-omr">
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        body { background: #e9ecf1; }
        .print-omr .tools { max-width: 210mm; margin: 16px auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .print-omr .tools p { margin: 0; flex: 1; min-width: 240px; font-size: 13px; color: #555; }
        .print-omr .paper { width: 210mm; height: 297mm; margin: 0 auto 24px; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
        .print-omr .paper svg { display: block; width: 100%; height: 100%; }
        @media print {
          body { background: #fff; }
          .print-omr .tools { display: none; }
          .print-omr .paper { margin: 0; box-shadow: none; }
        }
      `}</style>
      <div className="tools">
        <Link className="btn ghost" href={`/staff/exams/${e.id}`}>← 시험으로</Link>
        <PrintButton />
        <p>인쇄 설정에서 <b>용지 A4 · 배율 100%(실제 크기)</b>로 인쇄하세요. 여백은 「없음」 또는 기본값이어도 됩니다. 필요한 매수만큼 복사해서 나눠 주세요.</p>
      </div>
      {layout ? (
        <div className="paper" dangerouslySetInnerHTML={{ __html: sheetSvg({ layout, examId: e.id, title: e.title, sub }) }} />
      ) : (
        <div className="tools"><div className="flash err">{e.n_items}문항 {e.choices}지선다는 한 장에 들어가지 않습니다. 시험을 나눠 만들어 주세요.</div></div>
      )}
    </div>
  );
}
