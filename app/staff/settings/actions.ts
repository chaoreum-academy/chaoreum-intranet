'use server';
import { revalidatePath } from 'next/cache';
import { requireRole, back } from '@/lib/auth';
import { ALIGO_KEYS, clearSettingsCache } from '@/lib/settings';
import { aligoConfigured } from '@/lib/aligo';

const P = '/staff/settings';

/** 빈칸은 기존 값 유지. 본사 관리자만 (DB도 본사만 허용) */
export async function saveAligo(form: FormData) {
  const me = await requireRole(['hq_admin']);
  const rows = ALIGO_KEYS.map((key) => ({ key, value: String(form.get(key) || '').trim() })).filter((r) => r.value);
  if (!rows.length) back(P, 'err', '바꿀 값을 입력해 주세요. (빈칸은 기존 값 그대로)');
  const { error } = await me.sb.from('app_settings').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
  if (error) back(P, 'err', error.message);
  clearSettingsCache();
  revalidatePath(P);
  back(P, 'ok', `${rows.length}개 항목을 저장했습니다. 「연결 확인」을 눌러 보세요.`);
}

/** 알리고에 토큰 발급을 요청해 키·아이디가 맞는지 확인 (메시지는 보내지 않음) */
export async function testAligo() {
  await requireRole(['hq_admin']);
  clearSettingsCache();
  const conf = await aligoConfigured();
  if (!conf.ok) back(P, 'err', '아직 입력하지 않은 항목: ' + conf.missing.join(', '));
  try {
    const res = await fetch('https://kakaoapi.aligo.in/akv10/token/create/30/s/', {
      method: 'POST', cache: 'no-store',
      body: new URLSearchParams({ apikey: conf.cfg.ALIGO_API_KEY, userid: conf.cfg.ALIGO_USER_ID }),
    });
    const r = await res.json();
    if (r.code === 0) back(P, 'ok', '알리고 연결 성공: API 키와 아이디가 맞습니다. 「알림톡」 메뉴에서 템플릿을 등록하고 테스트 발송해 보세요.');
    back(P, 'err', `알리고가 거절했습니다: [${r.code}] ${r.message}` + (/ip/i.test(String(r.message)) ? '\n→ 알리고의 발송 IP 제한 문제입니다. 이 문구를 담당 개발자에게 전달해 주세요.' : ''));
  } catch (e: any) {
    if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e;
    back(P, 'err', '알리고 서버에 연결하지 못했습니다: ' + (e?.message ?? e));
  }
}
