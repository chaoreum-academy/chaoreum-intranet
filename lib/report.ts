import type { Me } from './auth';
import { areaRates, areaStats, fromOx, pts, reportComment, weakAreas, type ItemInfo } from './omr/engine';
import { seoulDate } from './ids';

export type ReportExam = {
  id: string; title: string; cls: string; date: string; score: number; right: number; total: number;
  ox: number[]; areas: { area: string; rate: number; need: boolean }[]; comment: string;
};
export type ReportData = { name: string; exams: ReportExam[] };

/**
 * 학생 리포트 데이터 (원본 getReport와 같은 계산).
 * 1차 응시만, 제출 순서대로. 권한은 RLS가 확인 — 본인·학부모·담당 직원만 읽힌다.
 */
export async function buildReport(me: Me, studentId: string): Promise<ReportData | null> {
  const sb = me.sb;
  const { data: st } = await sb.from('students').select('name').eq('id', studentId).maybeSingle();
  if (!st) return null;
  const { data: subs } = await sb.from('submissions')
    .select('exam_id, ox, score, n, submitted_at, exams(title, classes(name))')
    .eq('student_id', studentId).eq('attempt', 1).order('submitted_at');
  const list = subs ?? [];
  const examIds = list.map((s) => s.exam_id);
  const [{ data: items }, peers] = await Promise.all([
    examIds.length ? sb.from('exam_items').select('exam_id, no, area, concept, fix').in('exam_id', examIds) : Promise.resolve({ data: [] as any[] }),
    Promise.all(examIds.map((id) => sb.rpc('exam_peer_ox', { p_exam: id }).then((r) => (r.data as string[] | null) ?? []))),
  ]);
  const infoBy: Record<string, ItemInfo> = {};
  (items ?? []).forEach((it: any) => {
    (infoBy[it.exam_id] ||= {})[it.no] = { area: it.area || '', concept: it.concept || '', fix: it.fix || '' };
  });
  const exams = list.map((s: any, i) => {
    const info = infoBy[s.exam_id] || {};
    const g = fromOx(s.ox);
    const stats = areaStats(info, g);
    return {
      id: s.exam_id, title: s.exams?.title ?? '', cls: s.exams?.classes?.name ?? '', date: seoulDate(s.submitted_at),
      score: pts(s.score, s.n), right: s.score, total: s.n, ox: g.ox,
      areas: areaRates(info, g, peers[i]), comment: reportComment(st.name, s.exams?.title ?? '', g, stats, weakAreas(stats), info),
    };
  });
  return { name: st.name, exams };
}
