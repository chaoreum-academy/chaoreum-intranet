'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard, Users, CalendarCheck, School, ClipboardCheck, MessageSquare, UserCog, Settings, Search, Menu, LogOut, Upload, CreditCard,
} from 'lucide-react';
import { Avatar } from './Avatar';

const ICONS = { LayoutDashboard, Users, CalendarCheck, School, ClipboardCheck, MessageSquare, UserCog, Settings, Upload, CreditCard };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };
export type NavGroup = { label?: string; items: NavItem[] };

export function Shell(props: {
  groups: NavGroup[]; name: string; roleLabel: string; today: string;
  branches: { id: string; name: string }[]; currentBranch: string | null;
  logout: () => Promise<void>; setBranch: (f: FormData) => Promise<void>; children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isOn = (href: string) => (href === '/staff' ? path === '/staff' : path === href || path.startsWith(href + '/'));

  return (
    <div className={'shell' + (open ? ' open' : '')} onClick={(e) => { if (open && (e.target as HTMLElement).classList.contains('shell')) setOpen(false); }}>
      <aside className="side" aria-label="메뉴">
        <Link href="/staff" className="brand" onClick={() => setOpen(false)}>
          <span className="mark">차</span>
          <span><b>차오름학원</b><span>통합 관리</span></span>
        </Link>
        <nav className="nav">
          {props.groups.map((g, i) => (
            <div key={i}>
              {g.label && <div className="grp">{g.label}</div>}
              {g.items.map((it) => {
                const Icon = ICONS[it.icon];
                return (
                  <Link key={it.href} href={it.href} className={isOn(it.href) ? 'on' : ''} onClick={() => setOpen(false)}>
                    <Icon size={18} strokeWidth={2} />{it.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="userbox">
          <Avatar name={props.name} />
          <div className="who"><b>{props.name}</b>{props.roleLabel}</div>
          <form action={props.logout}><button className="iconbtn" aria-label="로그아웃" title="로그아웃"><LogOut size={16} /></button></form>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="top">
          <button className="iconbtn mobile-only" aria-label="메뉴 열기" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <form className="search" action="/staff/students" method="get" role="search">
            <Search size={16} />
            <input name="q" placeholder="학생 이름·학번 검색" aria-label="학생 검색" />
          </form>
          <div className="spacer" />
          {props.branches.length > 1 && (
            <form action={props.setBranch}>
              <select name="branch" defaultValue={props.currentBranch ?? ''} aria-label="지점 선택" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
                <option value="">전체 지점</option>
                {props.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </form>
          )}
          <span className="today">{props.today}</span>
          <Link className="btn" href="/staff/attendance"><CalendarCheck size={16} />출결</Link>
        </header>
        <main className="main">{props.children}</main>
      </div>
    </div>
  );
}
