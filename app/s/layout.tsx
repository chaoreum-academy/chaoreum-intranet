import { requireRole } from '@/lib/auth';
import { logout } from '../actions';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const me = await requireRole(['student']);
  return (
    <div className="m">
      <div className="mtop">
        <div className="who">{me.name}<span>학생</span></div>
        <form action={logout}><button type="submit">로그아웃</button></form>
      </div>
      {children}
    </div>
  );
}
