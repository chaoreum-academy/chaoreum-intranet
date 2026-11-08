import Link from 'next/link';
import { requireRole, BRANCH_ADMIN } from '@/lib/auth';
import { branchScope } from '@/lib/branch';
import { ImportWizard } from './ImportWizard';

export const maxDuration = 60;

export default async function ImportPage() {
  const me = await requireRole(BRANCH_ADMIN);
  const scope = await branchScope(me);
  return (
    <>
      <div className="head">
        <div>
          <div className="crumb"><Link href="/staff/students">학생</Link></div>
          <h1>학생 명단 가져오기</h1>
          <div className="sub">학번·이름·학교·학년·연락처·보호자 연락처·반을 한 번에 넣습니다. 머리글 이름은 자동으로 알아봅니다.</div>
        </div>
      </div>
      <ImportWizard branches={scope.branches} defaultBranch={scope.current} canCreateClasses={me.role !== 'desk'} />
    </>
  );
}
