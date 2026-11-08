/**
 * 알리고 카카오 알림톡 API (서버 전용)
 * 필요한 값: ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_KEY(카카오 발신프로필 키), ALIGO_SENDER(등록된 발신번호)
 * 사이트의 「연동 설정」 화면에 넣으면 된다. (Vercel 환경변수로 넣어도 됨, 그쪽이 우선)
 * 흐름: 토큰 발급 → 알림톡 발송. 카톡 실패 시 같은 내용 문자로 대체 발송(failover).
 */
const BASE = 'https://kakaoapi.aligo.in/akv10';

import { getSettings, ALIGO_KEYS } from './settings';

/** 알리고 키: 「연동 설정」 화면(DB) 또는 Vercel 환경변수 */
export async function aligoConfigured(): Promise<{ ok: boolean; missing: string[]; cfg: Record<string, string> }> {
  const cfg = await getSettings();
  const missing = ALIGO_KEYS.filter((k) => !cfg[k]);
  return { ok: !missing.length, missing: [...missing], cfg };
}

async function post(path: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const res = await fetch(BASE + path, { method: 'POST', body, cache: 'no-store' });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { code: -999, message: '알리고 응답을 읽지 못함: ' + text.slice(0, 200) }; }
}

let cached: { token: string; until: number } | null = null;

async function token(cfg: Record<string, string>): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const r = await post('/token/create/30/s/', { apikey: cfg.ALIGO_API_KEY, userid: cfg.ALIGO_USER_ID });
  if (r.code !== 0 || !r.token) throw new Error('알리고 토큰 발급 실패: ' + (r.message ?? JSON.stringify(r)));
  cached = { token: r.token, until: Date.now() + 25 * 1000 };
  return r.token;
}

export function normalizePhone(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '');
}

export async function sendAlimtalk(p: { tplCode: string; receiver: string; subject: string; message: string; buttonJson?: string | null }):
  Promise<{ ok: boolean; result: string }> {
  const conf = await aligoConfigured();
  if (!conf.ok) return { ok: false, result: '알리고 설정 없음: ' + conf.missing.join(', ') + ' (연동 설정 화면에서 입력)' };
  const cfg = conf.cfg;
  const receiver = normalizePhone(p.receiver);
  if (!/^01\d{8,9}$/.test(receiver)) return { ok: false, result: '휴대폰 번호 형식 오류: ' + p.receiver };
  try {
    const fields: Record<string, string> = {
      apikey: cfg.ALIGO_API_KEY, userid: cfg.ALIGO_USER_ID, token: await token(cfg),
      senderkey: cfg.ALIGO_SENDER_KEY, tpl_code: p.tplCode, sender: normalizePhone(cfg.ALIGO_SENDER),
      receiver_1: receiver, subject_1: p.subject, message_1: p.message,
      failover: 'Y', fsubject_1: p.subject, fmessage_1: p.message,
    };
    if (p.buttonJson && p.buttonJson.trim()) fields.button_1 = p.buttonJson.trim();
    const r = await post('/alimtalk/send/', fields);
    if (r.code === 0) return { ok: true, result: r.message || '전송 요청 완료' };
    return { ok: false, result: `[${r.code}] ${r.message ?? JSON.stringify(r)}` };
  } catch (e: any) {
    return { ok: false, result: e?.message || String(e) };
  }
}
