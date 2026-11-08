import { redirect } from 'next/navigation';
import { cache } from 'react';
import { supabaseServer } from './supabase/server';

export type Role = 'hq_admin' | 'branch_manager' | 'desk' | 'teacher' | 'student' | 'parent';
export const STAFF: Role[] = ['hq_admin', 'branch_manager', 'desk', 'teacher'];
export const BRANCH_ADMIN: Role[] = ['hq_admin', 'branch_manager', 'desk'];

export const ROLE_LABEL: Record<Role, string> = {
  hq_admin: '본사 관리자', branch_manager: '지점 실장', desk: '데스크', teacher: '강사', student: '학생', parent: '학부모',
};

export type Me = {
  sb: ReturnType<typeof supabaseServer>;
  userId: string;
  role: Role;
  name: string;
};

/** 한 화면을 그리는 동안 로그인 확인은 한 번만 (레이아웃·페이지가 같은 결과를 나눠 씀) */
export const getMe = cache(async function getMe(): Promise<Me | null> {
  const sb = supabaseServer();
  // 쿠키의 세션으로 사용자 id를 먼저 알고, '진짜 로그인인지 확인'과 '역할 조회'를 동시에 보낸다 (왕복 1번 절약)
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const [{ data: { user } }, { data: p }] = await Promise.all([
    sb.auth.getUser(),
    sb.from('profiles').select('role, display_name, active').eq('id', session.user.id).maybeSingle(),
  ]);
  if (!user || user.id !== session.user.id || !p || !p.active) return null;
  return { sb, userId: user.id, role: p.role as Role, name: p.display_name };
});

export function homeFor(role: Role): string {
  if (STAFF.includes(role)) return '/staff';
  return role === 'student' ? '/s' : '/p';
}

export async function requireRole(roles: Role[]): Promise<Me> {
  const me = await getMe();
  if (!me) redirect('/login?err=' + encodeURIComponent('계정이 없거나 사용이 중지되었습니다. 학원에 문의해 주세요.'));
  if (!roles.includes(me.role)) redirect(homeFor(me.role));
  return me;
}

/** 내가 관리하는 지점 목록 (본사는 전체) */
export const myBranches = cache(async function myBranches(me: Me): Promise<{ id: string; name: string }[]> {
  if (me.role === 'hq_admin') {
    const { data } = await me.sb.from('branches').select('id, name').order('sort');
    return data ?? [];
  }
  const { data } = await me.sb.from('staff_branches').select('branches(id, name, sort)').eq('user_id', me.userId);
  return (data ?? []).map((r: any) => r.branches).filter(Boolean).sort((a: any, b: any) => a.sort - b.sort);
});

/** 처리 결과를 주소에 실어 보내고 화면 상단에 표시 */
export function back(path: string, kind: 'ok' | 'err', msg: string): never {
  const sep = path.includes('?') ? '&' : '?';
  redirect(path + sep + kind + '=' + encodeURIComponent(msg));
}
