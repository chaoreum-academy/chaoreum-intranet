'use server';
import { requireRole } from '@/lib/auth';
import { sendOmrResult } from '@/lib/notify';

export type SubmitResult = { ok: true; score: number; n: number; wrong: number[]; attempt: number } | { ok: false; msg: string };

/** 채점은 DB 함수(submit_exam)가 정답을 보고 한다. 화면에는 정답이 전달되지 않는다. */
export async function submitExam(examId: string, answers: number[]): Promise<SubmitResult> {
  const me = await requireRole(['student']);
  const { data, error } = await me.sb.rpc('submit_exam', { p_exam: examId, p_answers: answers.map((a) => a || 0) });
  if (error) return { ok: false, msg: error.message };
  const r = data as { score: number; n: number; wrong: number[]; attempt: number };

  // 시험에 '자동 발송'이 켜져 있으면 학부모 알림톡 (실패해도 학생 화면에는 영향 없음, 발송 기록에 남음)
  try {
    const { data: sid } = await me.sb.rpc('my_student_id');
    const { data: sub } = await me.sb.from('submissions').select('id').eq('exam_id', examId).eq('student_id', sid).eq('attempt', r.attempt).maybeSingle();
    if (sub) await sendOmrResult(sub.id, { trigger: 'auto' });
  } catch (e) {
    console.error('알림톡 자동 발송 오류', e);
  }
  return { ok: true, ...r };
}
