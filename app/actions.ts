'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { studentEmail } from '@/lib/ids';

function fail(msg: string): never {
  redirect('/login?err=' + encodeURIComponent(msg));
}

export async function login(form: FormData) {
  const id = String(form.get('id') || '').trim();
  const password = String(form.get('password') || '');
  if (!id || !password) fail('아이디와 비밀번호를 입력해 주세요.');

  // 설정 누락은 비밀번호 오류와 구분해서 알려 준다
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!url || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) fail('[설정 오류] Vercel 환경변수에 Supabase 주소나 anon 키가 비어 있습니다.');
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) fail('[설정 오류] NEXT_PUBLIC_SUPABASE_URL 형식이 이상합니다: ' + url);

  // 직원·학부모는 이메일, 학생은 학번
  const email = id.includes('@') ? id.toLowerCase() : studentEmail(id);
  let message = '';
  try {
    const { error } = await supabaseServer().auth.signInWithPassword({ email, password });
    if (error) message = error.message;
  } catch (e: any) {
    message = '[연결 실패] ' + (e?.message || String(e));
  }
  if (message === 'Invalid login credentials') fail('아이디 또는 비밀번호가 맞지 않습니다.');
  if (message === 'Email not confirmed') fail('이메일 인증이 안 된 계정입니다. 관리자에게 문의하세요.');
  if (message.includes('Invalid API key')) fail('[설정 오류] anon 키가 잘못되었습니다. Vercel 환경변수를 확인하세요.');
  if (message) fail('[로그인 오류] ' + message);
  redirect('/');
}

export async function logout() {
  await supabaseServer().auth.signOut();
  redirect('/login');
}

export async function setBranch(form: FormData) {
  const { cookies, headers } = await import('next/headers');
  const v = String(form.get('branch') || '');
  if (v) cookies().set('branch', v, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  else cookies().delete('branch');
  const ref = headers().get('referer');
  let back = '/staff';
  try { if (ref) { const u = new URL(ref); if (u.pathname.startsWith('/staff')) back = u.pathname + u.search; } } catch {}
  redirect(back);
}
