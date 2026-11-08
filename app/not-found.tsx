import Link from 'next/link';
export default function NotFound() {
  return <div className="m" style={{ paddingTop: 60 }}><div className="card">찾는 화면이 없거나 볼 권한이 없습니다. <Link href="/">처음으로</Link></div></div>;
}
