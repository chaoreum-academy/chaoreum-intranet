import { cookies } from 'next/headers';
import { myBranches, type Me } from './auth';

/**
 * 상단 '지점 선택' (본사·여러 지점 실장용). 쿠키에 저장되고 학생·반·출결·대시보드 목록을 걸러 준다.
 * 권한 자체는 DB(RLS)가 막으므로 이것은 '보기 편하게 거르는' 용도.
 */
export async function branchScope(me: Me): Promise<{ branches: { id: string; name: string }[]; current: string | null }> {
  if (me.role === 'teacher') return { branches: [], current: null };
  const branches = await myBranches(me);
  const c = cookies().get('branch')?.value;
  return { branches, current: branches.find((b) => b.id === c)?.id ?? null };
}
