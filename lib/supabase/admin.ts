import { createClient } from '@supabase/supabase-js';

/**
 * 관리자 키 접속 — RLS를 건너뜁니다. 로그인 계정 생성·비밀번호 초기화에만 사용.
 * 호출 전에 반드시 "이 사람이 이 일을 해도 되는지"를 일반 접속(supabaseServer)으로 확인할 것.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
