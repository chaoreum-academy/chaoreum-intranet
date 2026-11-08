import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** 로그인한 사용자 권한으로 DB에 접속 (RLS 적용). 대부분의 화면은 이것만 씁니다. */
export function supabaseServer() {
  const store = cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* 서버 컴포넌트에서는 쿠키를 못 쓴다 — middleware가 갱신 */
        }
      },
    },
  });
}
