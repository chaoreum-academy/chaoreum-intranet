/**
 * OMR 결과 → 학부모 알림톡
 * 서버 전용. 관리자 키로 읽고 쓰므로, 부르는 쪽에서 권한 확인을 먼저 해야 한다.
 */
import { supabaseAdmin } from './supabase/admin';
import { sendAlimtalk, normalizePhone } from './aligo';
import { areaStats, fromOx, hangul, parentMessage, pts, weakAreas, weakSummary, type ItemInfo } from './omr/engine';

/** 템플릿에 쓸 수 있는 변수 (설정 화면 안내용) */
export const OMR_VARS: [string, string][] = [
  ['학생명', '김민준'], ['이름', '민준 (성 뺀 이름)'], ['강사명', '시험을 만든 강사'], ['학원명', '차오름학원'],
  ['반', '광북1A'], ['시험명', '복습테스트 3회'], ['날짜', '11/8'],
  ['점수', '90 (100점 만점)'], ['문항수', '20'], ['정답수', '18'], ['오답', '3, 12 (없으면 없음)'],
  ['부족영역', '문법(3, 12번)'], ['안내문구', '시험의 문자 안내 중 점수대에 맞는 문장'],
  ['결과문자', '기존 OMR 시트의 학부모 문자 전문 (링크 제외)'], ['리포트링크', '학부모 리포트 주소'],
];

export function renderTemplate(body: string, vars: Record<string, string>): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const text = body.replace(/#\{([^}]+)\}/g, (m, k: string) => {
    const key = k.trim();
    if (vars[key] === undefined) { unknown.push(key); return m; }
    return vars[key];
  });
  return { text, unknown };
}

export async function omrVars(submissionId: string) {
  const admin = supabaseAdmin();
  const { data: s } = await admin.from('submissions')
    .select('id, ox, score, n, attempt, submitted_at, student_id, exam_id, students(name, guardian_phone), exams(id, title, guide, created_by, notify_template_id, notify_auto, classes(name))')
    .eq('id', submissionId).maybeSingle();
  if (!s) throw new Error('제출 기록을 찾지 못했습니다.');
  const sub: any = s;
  const [{ data: items }, { data: author }] = await Promise.all([
    admin.from('exam_items').select('no, area, concept, fix').eq('exam_id', sub.exam_id),
    sub.exams?.created_by ? admin.from('profiles').select('display_name').eq('id', sub.exams.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const info: ItemInfo = {};
  (items ?? []).forEach((it: any) => { info[it.no] = { area: it.area || '', concept: it.concept || '', fix: it.fix || '' }; });
  const g = fromOx(sub.ox);
  const weak = weakAreas(areaStats(info, g));
  const name: string = sub.students?.name ?? '';
  const teacher = (author as any)?.display_name ?? '';
  const url = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '') + '/p';
  const rate = (g.wrong.length / g.n) * 100;
  const guideParts = String(sub.exams?.guide || '').split('|').map((x) => x.trim());
  const full = parentMessage({ name, teacher, guide: sub.exams?.guide || '', g, weak, url });
  const d = new Date(sub.submitted_at);
  const vars: Record<string, string> = {
    학생명: hangul(name), 이름: hangul(name).length >= 2 ? hangul(name).slice(1) : hangul(name), 강사명: teacher, 학원명: '차오름학원',
    반: sub.exams?.classes?.name ?? '', 시험명: sub.exams?.title ?? '',
    날짜: new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(d).replace(/\.\s?/g, '/').replace(/\/$/, ''),
    점수: String(pts(sub.score, sub.n)), 문항수: String(sub.n), 정답수: String(sub.score),
    오답: g.wrong.length ? g.wrong.join(', ') : '없음', 부족영역: weakSummary(weak) || '없음',
    안내문구: (rate <= 20 ? guideParts[0] : rate <= 50 ? guideParts[1] : guideParts[2]) || '',
    결과문자: full.split('\n').slice(0, -1).join('\n'), 리포트링크: url,
  };
  return { sub, vars, receiver: normalizePhone(sub.students?.guardian_phone) };
}

/**
 * 한 제출에 대해 결과 알림톡 발송. 이미 보낸 건은 force 없이는 다시 보내지 않는다.
 * trigger: 'auto'(학생 제출 즉시) | 'manual'(강사가 버튼으로)
 */
export async function sendOmrResult(submissionId: string, opt: { trigger: 'auto' | 'manual'; force?: boolean; by?: string | null }) {
  const admin = supabaseAdmin();
  const { sub, vars, receiver } = await omrVars(submissionId);
  const tplId = sub.exams?.notify_template_id;
  const log = (status: 'sent' | 'failed' | 'skipped', result: string, body?: string) =>
    admin.from('message_logs').insert({
      student_id: sub.student_id, exam_id: sub.exam_id, submission_id: sub.id, template_id: tplId ?? null,
      receiver: receiver || null, body: body ?? null, status, result, trigger: opt.trigger, sent_by: opt.by ?? null,
    });

  if (opt.trigger === 'auto' && !sub.exams?.notify_auto) return { ok: false, result: '자동 발송 꺼짐' };
  if (sub.attempt > 1) return { ok: false, result: '재시험 결과는 자동 발송하지 않습니다.' };
  if (!tplId) return { ok: false, result: '이 시험에 알림톡 템플릿이 지정되지 않았습니다.' };
  if (!opt.force) {
    const { count } = await admin.from('message_logs').select('id', { count: 'exact', head: true }).eq('submission_id', sub.id).eq('status', 'sent');
    if (count) return { ok: false, result: '이미 발송했습니다.' };
  }
  const { data: tpl } = await admin.from('message_templates').select('tpl_code, subject, body, button_json, active').eq('id', tplId).maybeSingle();
  if (!tpl || !tpl.active) { await log('skipped', '템플릿 없음 또는 사용 중지'); return { ok: false, result: '템플릿이 없거나 사용 중지 상태입니다.' }; }
  if (!receiver) { await log('skipped', '보호자 연락처 없음'); return { ok: false, result: '보호자 연락처가 없습니다.' }; }

  const msg = renderTemplate(tpl.body, vars);
  if (msg.unknown.length) { await log('failed', '알 수 없는 변수: ' + msg.unknown.join(', '), msg.text); return { ok: false, result: '템플릿에 알 수 없는 변수: ' + msg.unknown.join(', ') }; }
  const btn = tpl.button_json ? renderTemplate(tpl.button_json, vars).text : null;
  const r = await sendAlimtalk({ tplCode: tpl.tpl_code, receiver, subject: tpl.subject, message: msg.text, buttonJson: btn });
  await log(r.ok ? 'sent' : 'failed', r.result, msg.text);
  return r;
}
