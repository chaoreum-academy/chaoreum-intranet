/**
 * 인쇄용 OMR 답안지 양식 (A4 세로, 단위 mm).
 *
 * 사진 인식(scan.ts)은 이 파일의 좌표를 그대로 쓴다. 양식을 바꾸면 인쇄물과 인식이 함께 바뀌므로
 * 이미 인쇄해 둔 답안지가 있다면 SHEET_VERSION을 올리고 새로 인쇄하세요.
 *
 * - 네 모서리 검은 네모: 사진 속 종이 위치·기울기를 찾는 기준점
 * - 왼쪽 위 검은 막대: 종이가 거꾸로 찍혔는지 판단
 * - 아래쪽 16칸 코드: 시험마다 다른 무늬 → 다른 시험 답안지를 찍으면 알려 줌
 */
export const SHEET_VERSION = 1;
export const PAGE = { w: 210, h: 297 };
export const MARK = 10; // 모서리 네모 한 변
/** 모서리 네모 중심: 왼쪽위, 오른쪽위, 오른쪽아래, 왼쪽아래 (시계 방향) */
export const CORNERS: [number, number][] = [[15, 15], [195, 15], [195, 282], [15, 282]];
export const BAR = { x: 24, y: 12, w: 30, h: 6 };
export const CODE = { x: 40, y: 268, size: 4, step: 6, bits: 16 };
const GRID = { x: 22, y: 50, w: 164, h: 210 };
const NUM_W = 9;
const COL_GAP = 4;
const GROUP_GAP = 1.4;

export type Pt = { x: number; y: number };
export type Layout = {
  n: number;
  choices: number;
  r: number; // 칸 반지름
  bubbles: Pt[][]; // [문항][선택지] 중심
  numbers: Pt[]; // 문항 번호 글자 위치
  columns: { x: number; y: number; w: number; h: number }[];
  separators: { x1: number; x2: number; y: number }[];
};

const SIZES = [
  { rowH: 7, dx: 7, r: 2.4 },
  { rowH: 6.2, dx: 6.4, r: 2.2 },
  { rowH: 5.6, dx: 5.8, r: 2.0 },
];

/** 문항 수·선택지 수로 양식 계산. 한 장에 안 들어가면 null */
export function sheetLayout(n: number, choices: number): Layout | null {
  if (n < 1 || choices < 2 || choices > 9) return null;
  for (const s of SIZES) {
    const colW = NUM_W + choices * s.dx + COL_GAP;
    const cols = Math.floor(GRID.w / colW);
    if (!cols) continue;
    const height = (rows: number) => rows * s.rowH + Math.floor((rows - 1) / 5) * GROUP_GAP;
    let maxRows = Math.floor(GRID.h / s.rowH);
    while (maxRows > 0 && height(maxRows) > GRID.h) maxRows--;
    // 한 열에 20문항(시중 OMR과 같은 모양)이 기본, 모자라면 5의 배수로 늘림
    let per = n <= 20 ? n : Math.ceil(Math.ceil(n / cols) / 5) * 5;
    if (n > 20 && per < 20) per = 20;
    per = Math.min(per, maxRows);
    if (per * cols < n) continue;
    const used = Math.ceil(n / per);
    const x0 = GRID.x + (GRID.w - used * colW + COL_GAP) / 2;
    const bubbles: Pt[][] = [];
    const numbers: Pt[] = [];
    for (let q = 0; q < n; q++) {
      const col = Math.floor(q / per), row = q % per;
      const cx0 = x0 + col * colW;
      const cy = GRID.y + row * s.rowH + Math.floor(row / 5) * GROUP_GAP + s.rowH / 2;
      numbers.push({ x: cx0 + NUM_W / 2, y: cy });
      bubbles.push(Array.from({ length: choices }, (_, c) => ({ x: cx0 + NUM_W + s.dx * (c + 0.5), y: cy })));
    }
    const columns: Layout['columns'] = [];
    const separators: Layout['separators'] = [];
    for (let col = 0; col < used; col++) {
      const rows = Math.min(per, n - col * per);
      const x = x0 + col * colW;
      columns.push({ x, y: GRID.y, w: colW - COL_GAP, h: height(rows) });
      for (let g = 5; g < rows; g += 5) {
        separators.push({ x1: x, x2: x + colW - COL_GAP, y: GRID.y + g * s.rowH + (g / 5 - 0.5) * GROUP_GAP });
      }
    }
    return { n, choices, r: s.r, bubbles, numbers, columns, separators };
  }
  return null;
}

/** 시험 id → 16비트 확인 코드 (FNV-1a) */
export function examCode(examId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < examId.length; i++) {
    h ^= examId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h ^ (h >>> 16)) & 0xffff;
}

export function codeCells(): Pt[] {
  return Array.from({ length: CODE.bits }, (_, i) => ({ x: CODE.x + i * CODE.step + CODE.size / 2, y: CODE.y + CODE.size / 2 }));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const f = (v: number) => Math.round(v * 100) / 100;

/** 답안지 한 장 SVG (인쇄 화면과 테스트에서 같이 사용) */
export function sheetSvg(o: { layout: Layout; examId: string; title: string; sub: string; marks?: number[] }): string {
  const L = o.layout;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE.w} ${PAGE.h}" width="${PAGE.w}mm" height="${PAGE.h}mm" font-family="'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif">`);
  out.push(`<rect width="${PAGE.w}" height="${PAGE.h}" fill="#fff"/>`);
  CORNERS.forEach(([x, y]) => out.push(`<rect x="${x - MARK / 2}" y="${y - MARK / 2}" width="${MARK}" height="${MARK}" fill="#000"/>`));
  out.push(`<rect x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" fill="#000"/>`);
  out.push(`<text x="60" y="17.2" font-size="5.2" font-weight="700">${esc(o.title)}</text>`);
  out.push(`<text x="24" y="27" font-size="3.4" fill="#333">${esc(o.sub)}</text>`);
  out.push(`<text x="24" y="37" font-size="3.6">이름 ____________________</text>`);
  out.push(`<text x="24" y="44.5" font-size="2.7" fill="#555">진한 연필·컴퓨터용 사인펜으로 칸을 꽉 채우세요. 고칠 때는 깨끗이 지우세요. 사진은 네 모서리 검은 네모가 모두 나오게 찍어 주세요.</text>`);
  L.columns.forEach((c) => out.push(`<rect x="${f(c.x - 1)}" y="${f(c.y - 1)}" width="${f(c.w + 2)}" height="${f(c.h + 2)}" fill="none" stroke="#444" stroke-width="0.3" rx="1"/>`));
  L.separators.forEach((s) => out.push(`<line x1="${f(s.x1)}" x2="${f(s.x2)}" y1="${f(s.y)}" y2="${f(s.y)}" stroke="#999" stroke-width="0.25"/>`));
  L.numbers.forEach((p, q) => out.push(`<text x="${f(p.x)}" y="${f(p.y + 1.15)}" font-size="3.2" font-weight="700" text-anchor="middle">${q + 1}</text>`));
  L.bubbles.forEach((row, q) => row.forEach((p, c) => {
    out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${L.r}" fill="#fff" stroke="#000" stroke-width="0.3"/>`);
    out.push(`<text x="${f(p.x)}" y="${f(p.y + L.r * 0.42)}" font-size="${f(L.r * 1.2)}" fill="#c8c8c8" text-anchor="middle">${c + 1}</text>`);
    if (o.marks?.[q] === c + 1) out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(L.r * 0.9)}" fill="#111"/>`);
  }));
  const code = examCode(o.examId);
  codeCells().forEach((p, i) => {
    const on = (code >> i) & 1;
    out.push(`<rect x="${f(p.x - CODE.size / 2)}" y="${f(p.y - CODE.size / 2)}" width="${CODE.size}" height="${CODE.size}" ${on ? 'fill="#000"' : 'fill="none" stroke="#000" stroke-width="0.25"'}/>`);
  });
  out.push(`<text x="${CODE.x + CODE.bits * CODE.step + 2}" y="${CODE.y + 3.2}" font-size="2.6" fill="#777">시험 확인 코드 · 칠하지 마세요</text>`);
  out.push(`<text x="105" y="294" font-size="2.6" fill="#999" text-anchor="middle">차오름학원 OMR v${SHEET_VERSION}</text>`);
  out.push('</svg>');
  return out.join('');
}
