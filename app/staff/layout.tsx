import { requireRole, STAFF, ROLE_LABEL } from '@/lib/auth';
import { branchScope } from '@/lib/branch';
import { Shell, type NavGroup } from '@/components/Shell';
import { seoulToday } from '@/lib/schedule';
import { logout, setBranch } from '../actions';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const me = await requireRole(STAFF);
  const scope = await branchScope(me);
  const t = seoulToday();
  const groups: NavGroup[] = [
    { items: [{ href: '/staff', label: '홈', icon: 'LayoutDashboard' }] },
    { label: '원생', items: [{ href: '/staff/students', label: '학생', icon: 'Users' }, { href: '/staff/attendance', label: '출결', icon: 'CalendarCheck' }] },
    { label: '수업', items: [{ href: '/staff/classes', label: '반', icon: 'School' }, { href: '/staff/exams', label: 'OMR 과제', icon: 'ClipboardCheck' }] },
    { label: '소통', items: [{ href: '/staff/messages', label: '알림톡', icon: 'MessageSquare' }] },
  ];
  if (me.role !== 'teacher') {
    groups.push({ label: '운영', items: [{ href: '/staff/payments', label: '수납·결제', icon: 'CreditCard' }] });
    const s: NavGroup = { label: '관리', items: [{ href: '/staff/accounts', label: '계정', icon: 'UserCog' }] };
    if (me.role === 'hq_admin') s.items.push({ href: '/staff/settings', label: '연동 설정', icon: 'Settings' });
    groups.push(s);
  }
  return (
    <Shell groups={groups} name={me.name} roleLabel={ROLE_LABEL[me.role]} today={`${Number(t.ymd.slice(5, 7))}월 ${Number(t.ymd.slice(8))}일 (${t.day})`}
      branches={scope.branches} currentBranch={scope.current} logout={logout} setBranch={setBranch}>
      {children}
    </Shell>
  );
}
