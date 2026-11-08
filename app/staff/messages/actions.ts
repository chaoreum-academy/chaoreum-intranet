'use server';
import { revalidatePath } from 'next/cache';
import { requireRole, STAFF, back } from '@/lib/auth';
import { sendAlimtalk } from '@/lib/aligo';
import { OMR_VARS, renderTemplate, sendOmrResult } from '@/lib/notify';

const P = '/staff/messages';

export async function saveTemplate(form: FormData) {
  const me = await requireRole(['hq_admin', 'branch_manager']);
  const id = String(form.get('id') || '');
  const row = {
    name: String(form.get('name') || '').trim(), tpl_code: String(form.get('tpl_code') || '').trim(),
    subject: String(form.get('subject') || '').trim() || '차오름학원',
    body: String(form.get('body') || '').replace(/\r\n/g, '\n'), button_json: String(form.get('button_json') || '').trim() || null,
  };
  if (!row.name || !row.tpl_code || !row.body.trim()) back(P, 'err', '이름, 템플릿 코드, 본문은 꼭 넣어야 합니다.');
  const known = new Set(OMR_VARS.map(([k]) => k));
  const unknown = Array.from(row.body.matchAll(/#\{([^}]+)\}/g)).map((m) => m[1].trim()).filter((k) => !known.has(k));
  const { error } = id ? await me.sb.from('message_templates').update(row).eq('id', id) : await me.sb.from('message_templates').insert(row);
  if (error) back(P, 'err', error.message);
  revalidatePath(P);
  back(P, unknown.length ? 'err' : 'ok', unknown.length
    ? `저장했지만, 이 변수는 자동으로 채울 수 없습니다: ${Array.from(new Set(unknown)).join(', ')}\n아래 변수 목록의 이름으로 바꾸거나 알려 주세요.`
    : '템플릿을 저장했습니다. 「내 번호로 테스트」로 확인해 보세요.');
}

export async function toggleTemplate(form: FormData) {
  const me = await requireRole(['hq_admin', 'branch_manager']);
  const { error } = await me.sb.from('message_templates').update({ active: form.get('active') === 'true' }).eq('id', String(form.get('id')));
  if (error) back(P, 'err', error.message);
  revalidatePath(P);
  back(P, 'ok', '저장했습니다.');
}

/** 예시 값으로 채워 내 휴대폰에 보내 보기 */
export async function testSend(form: FormData) {
  const me = await requireRole(['hq_admin', 'branch_manager']);
  const { data: tpl } = await me.sb.from('message_templates').select('tpl_code, subject, body, button_json').eq('id', String(form.get('id'))).maybeSingle();
  if (!tpl) back(P, 'err', '템플릿을 찾을 수 없습니다.');
  const sample: Record<string, string> = {
    학생명: '김민준', 이름: '민준', 강사명: me.name, 학원명: '차오름학원', 반: '광북1A', 시험명: '복습테스트 1회', 날짜: '11/8',
    점수: '90', 문항수: '10', 정답수: '9', 오답: '7', 부족영역: '문법(7번)', 안내문구: '아주 잘했어요!',
    결과문자: '(테스트) 기존 OMR 학부모 문자 전문이 들어가는 자리입니다.', 리포트링크: (process.env.NEXT_PUBLIC_APP_URL || '') + '/p',
  };
  const msg = renderTemplate(tpl.body, sample);
  const r = await sendAlimtalk({ tplCode: tpl.tpl_code, receiver: String(form.get('phone') || ''), subject: tpl.subject, message: msg.text,
    buttonJson: tpl.button_json ? renderTemplate(tpl.button_json, sample).text : null });
  back(P, r.ok ? 'ok' : 'err', r.ok ? '테스트 발송을 요청했습니다. 휴대폰을 확인하세요.\n\n보낸 내용:\n' + msg.text : '발송 실패: ' + r.result);
}

/* ── 시험 화면에서 쓰는 것 ── */

async function guardExam(examId: string) {
  const me = await requireRole(STAFF);
  const { data } = await me.sb.from('exams').select('id').eq('id', examId).maybeSingle(); // RLS: 담당 강사·지점 관리자만 보임
  if (!data) back(`/staff/exams/${examId}`, 'err', '이 시험을 관리할 권한이 없습니다.');
  return me;
}

export async function setExamNotify(form: FormData) {
  const examId = String(form.get('id'));
  const me = await guardExam(examId);
  const tpl = String(form.get('template_id') || '') || null;
  const { error } = await me.sb.from('exams').update({ notify_template_id: tpl, notify_auto: !!tpl && form.get('notify_auto') === 'on' }).eq('id', examId);
  if (error) back(`/staff/exams/${examId}`, 'err', error.message);
  revalidatePath(`/staff/exams/${examId}`);
  back(`/staff/exams/${examId}`, 'ok', tpl ? (form.get('notify_auto') === 'on' ? '저장했습니다. 이제 학생이 제출하면 학부모에게 바로 알림톡이 갑니다.' : '저장했습니다. 아래 「일괄 발송」으로 보낼 수 있습니다.') : '알림톡을 끄고 저장했습니다.');
}

/** 아직 안 보낸 1차 응시 결과 모두 발송 */
export async function sendExamResults(form: FormData) {
  const examId = String(form.get('id'));
  const me = await guardExam(examId);
  const { data: subs } = await me.sb.from('submissions').select('id').eq('exam_id', examId).eq('attempt', 1);
  let ok = 0; const fails: string[] = [];
  for (const s of subs ?? []) {
    const r = await sendOmrResult(s.id, { trigger: 'manual', by: me.userId });
    if (r.ok) ok++; else if (r.result !== '이미 발송했습니다.') fails.push(r.result);
  }
  revalidatePath(`/staff/exams/${examId}`);
  const reasons = Array.from(new Set(fails)).map((m) => `${m} (${fails.filter((x) => x === m).length}명)`);
  back(`/staff/exams/${examId}`, fails.length ? 'err' : 'ok', `발송 ${ok}건` + (fails.length ? `\n보내지 못함 ${fails.length}건:\n` + reasons.join('\n') : ''));
}

export async function resendOne(form: FormData) {
  const examId = String(form.get('exam_id'));
  const me = await guardExam(examId);
  const r = await sendOmrResult(String(form.get('submission_id')), { trigger: 'manual', force: true, by: me.userId });
  revalidatePath(`/staff/exams/${examId}`);
  back(`/staff/exams/${examId}`, r.ok ? 'ok' : 'err', r.ok ? '발송했습니다.' : '발송 실패: ' + r.result);
}
