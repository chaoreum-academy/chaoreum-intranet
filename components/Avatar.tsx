const PALETTE: [string, string][] = [
  ['#eaf0fa', '#1d3461'], ['#e7f6ef', '#12603f'], ['#fdf2e3', '#8a4a07'], ['#f3ecfb', '#5b3191'],
  ['#fdecea', '#9a2c24'], ['#e6f4f8', '#0f5a6e'], ['#f1f2f4', '#344054'], ['#fbeef4', '#8c2c55'],
];

/** 사진 대신 이름 끝 두 글자 동그라미 (이름마다 색이 고정) */
export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  const n = String(name || '?').replace(/[^가-힣a-zA-Z]/g, '') || '?';
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
  const [bg, fg] = PALETTE[Math.abs(h) % PALETTE.length];
  const label = /[가-힣]/.test(n) ? n.slice(-2) : n.slice(0, 2).toUpperCase();
  return <span className={'av' + (size ? ' ' + size : '')} style={{ background: bg, color: fg }} aria-hidden="true">{label}</span>;
}
