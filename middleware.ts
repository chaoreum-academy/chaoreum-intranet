import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** 매 요청마다 로그인 세션을 갱신하고, 로그인 안 한 사람은 로그인 화면으로 보냅니다. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // 여기서는 '로그인 쿠키가 있는지'만 보고 (만료됐으면 갱신), 진짜 확인은 각 화면의 getMe + DB 권한(RLS)이 한다
  const { data: { session } } = await supabase.auth.getSession();
  const path = request.nextUrl.pathname;
  if (!session && !path.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|webmanifest)$).*)'],
};
