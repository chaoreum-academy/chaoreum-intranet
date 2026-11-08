import { supabaseAdmin } from './supabase/admin';

/** 연동 설정 읽기 (서버 전용). Vercel 환경변수가 있으면 그것이 우선 */
export const ALIGO_KEYS = ['ALIGO_API_KEY', 'ALIGO_USER_ID', 'ALIGO_SENDER_KEY', 'ALIGO_SENDER'] as const;
export type AligoKey = (typeof ALIGO_KEYS)[number];

let cache: { at: number; values: Record<string, string> } | null = null;

export async function getSettings(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.values;
  const values: Record<string, string> = {};
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('key, value');
    (data ?? []).forEach((r) => { if (r.value) values[r.key] = r.value; });
  } catch { /* 관리자 키가 없으면 환경변수만 사용 */ }
  ALIGO_KEYS.forEach((k) => { if (process.env[k]) values[k] = process.env[k]!; });
  cache = { at: Date.now(), values };
  return values;
}

export function clearSettingsCache() { cache = null; }

export function mask(v: string | undefined): string {
  if (!v) return '';
  return v.length <= 6 ? '••••' : v.slice(0, 3) + '••••' + v.slice(-3);
}
