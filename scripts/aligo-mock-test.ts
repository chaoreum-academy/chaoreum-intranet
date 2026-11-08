// 알리고 서버 흉내: 토큰 → 발송 요청이 올바른 칸으로 가는지 확인
import { sendAlimtalk } from '../lib/aligo';
import { renderTemplate } from '../lib/notify';
const calls: { url: string; body: Record<string, string> }[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  const body = Object.fromEntries(new URLSearchParams(init.body.toString()));
  calls.push({ url, body });
  const json = url.includes('/token/') ? { code: 0, message: '정상적으로 생성하였습니다.', token: 'TKN' } : { code: 0, message: '성공적으로 전송요청 하였습니다.' };
  return { text: async () => JSON.stringify(json) } as any;
};
Object.assign(process.env, { ALIGO_API_KEY: 'k', ALIGO_USER_ID: 'u', ALIGO_SENDER_KEY: 'sk', ALIGO_SENDER: '02-123-4567', NEXT_PUBLIC_SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x' });
(async () => {
  const tpl = '[차오름학원] #{학생명} 학생 결과\n점수: #{점수}점\n틀린 문항: #{오답}';
  const m = renderTemplate(tpl, { 학생명: '김민준', 점수: '90', 오답: '7' });
  const bad = renderTemplate('#{학생명} #{모르는변수}', { 학생명: 'a' });
  const r = await sendAlimtalk({ tplCode: 'TA_1', receiver: '010-1234-5678', subject: '차오름학원', message: m.text });
  const r2 = await sendAlimtalk({ tplCode: 'TA_1', receiver: '02-123', subject: 's', message: 'x' });
  const send = calls.find((c) => c.url.includes('/alimtalk/send/'))!;
  const checks: [string, boolean][] = [
    ['변수 채움', m.text === '[차오름학원] 김민준 학생 결과\n점수: 90점\n틀린 문항: 7' && !m.unknown.length],
    ['모르는 변수 감지', bad.unknown.join() === '모르는변수'],
    ['발송 성공', r.ok],
    ['토큰 먼저 발급', calls[0].url.endsWith('/token/create/30/s/')],
    ['발송 칸', send.body.token === 'TKN' && send.body.tpl_code === 'TA_1' && send.body.receiver_1 === '01012345678' && send.body.sender === '021234567' && send.body.senderkey === 'sk' && send.body.message_1 === m.text],
    ['문자 대체 발송', send.body.failover === 'Y' && send.body.fmessage_1 === m.text],
    ['잘못된 번호 거절', !r2.ok && r2.result.includes('형식')],
  ];
  checks.forEach(([k, v]) => console.log(v ? 'PASS' : 'FAIL', k));
  process.exit(checks.every(([, v]) => v) ? 0 : 1);
})();
