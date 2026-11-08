/**
 * OMR 답안지 사진 인식 (학생 휴대폰 브라우저 안에서 실행, 서버·외부 라이브러리 없음).
 *
 * 1. 사진을 흑백으로 바꾸고, 주변보다 어두운 점만 골라 덩어리로 묶는다
 * 2. 덩어리 중 네모난 큰 것 4개 = 모서리 표시 → 사진 속 종이의 위치·기울기(원근)를 계산
 * 3. 왼쪽 위 막대로 종이 방향(거꾸로 찍었는지)을 정하고, 아래 코드로 이 시험 답안지가 맞는지 확인
 * 4. 각 칸 안쪽이 얼마나 어두운지 재서 문항마다 고른 번호를 정한다. 애매하면 '확인 필요'로 표시
 *
 * 결과는 바로 제출하지 않고 화면의 답안지에 채워 학생이 확인한 뒤 제출한다.
 */
import { BAR, CODE, CORNERS, MARK, PAGE, codeCells, examCode, type Layout, type Pt } from './sheet';

export type Gray = { w: number; h: number; px: Uint8Array };
export type Flag = 'ok' | 'blank' | 'multi' | 'unsure';
export type ScanResult =
  | { ok: true; answers: number[]; flags: Flag[]; fill: number[][]; corners: Pt[]; toImage: (p: Pt) => Pt; codeErrors: number }
  | { ok: false; msg: string };

/** RGBA → 흑백 */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const px = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < px.length; i++, j += 4) px[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { w, h, px };
}

/* ───────── 1. 어두운 덩어리 ───────── */

type Blob = { area: number; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number };

function darkMask(g: Gray): Uint8Array {
  const { w, h, px } = g;
  // 적분 영상으로 주변 평균 밝기 → 주변보다 확실히 어두운 점만 (그림자·조명 차이에 강함)
  const W1 = w + 1;
  const sum = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += px[y * w + x];
      sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 14));
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const s = sum[yb * W1 + xb] - sum[ya * W1 + xb] - sum[yb * W1 + xa] + sum[ya * W1 + xa];
      const mean = s / ((yb - ya) * (xb - xa));
      if (px[y * w + x] < mean * 0.72 && px[y * w + x] < 170) m[y * w + x] = 1;
    }
  }
  return m;
}

function blobs(mask: Uint8Array, w: number, h: number, minSide: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out: Blob[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw >= minSide && bh >= minSide) out.push({ area, x0, y0, x1, y1, cx: sx / area, cy: sy / area });
  }
  return out;
}

/* ───────── 2. 모서리 4개 ───────── */

/** 모서리 후보 네 점 묶음들 (큰 것부터). 책상 무늬 등 가짜가 섞일 수 있어 scanSheet가 하나씩 검증한다 */
export function findQuads(g: Gray): Pt[][] {
  const short = Math.min(g.w, g.h);
  const all = blobs(darkMask(g), g.w, g.h, Math.max(6, short * 0.012));
  const cand = all.filter((b) => {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    const fill = b.area / (bw * bh);
    return bw < short * 0.2 && bh < short * 0.2 && bw / bh < 1.8 && bh / bw < 1.8 && fill > 0.5;
  }).sort((a, b) => b.area - a.area).slice(0, 14);
  if (cand.length < 4) return [];

  const found: { score: number; pts: Pt[] }[] = [];
  const n = cand.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const q = [cand[a], cand[b], cand[c], cand[d]];
    const areas = q.map((x) => x.area);
    if (Math.max(...areas) > Math.min(...areas) * 3) continue;
    const ord = clockwise(q.map((x) => ({ x: x.cx, y: x.cy })));
    if (!convex(ord)) continue;
    const quad = polyArea(ord);
    // 모서리 표시 크기는 종이 크기에 비례해야 한다 (A4 기준 한 변 10mm ≒ 종이 폭의 5.5%)
    const side = Math.sqrt(areas.reduce((s, v) => s + v, 0) / 4);
    const expect = Math.sqrt(quad / ((CORNERS[1][0] - CORNERS[0][0]) * (CORNERS[3][1] - CORNERS[0][1]))) * MARK;
    if (side < expect * 0.5 || side > expect * 1.8) continue;
    if (quad < short * short * 0.15) continue;
    found.push({ score: quad, pts: ord });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 40).map((x) => x.pts);
}

function clockwise(p: Pt[]): Pt[] {
  const cx = p.reduce((s, v) => s + v.x, 0) / p.length, cy = p.reduce((s, v) => s + v.y, 0) / p.length;
  // 화면 좌표(y 아래로)에서 각도 오름차순 = 시계 방향. 왼쪽 위(각도 -135° 부근)부터 시작
  return [...p].sort((a, b) => ang(a) - ang(b));
  function ang(v: Pt) { let t = Math.atan2(v.y - cy, v.x - cx) + (3 * Math.PI) / 4; if (t < 0) t += 2 * Math.PI; return t; }
}
function cross(o: Pt, a: Pt, b: Pt) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
function convex(p: Pt[]) { const s = p.map((_, i) => Math.sign(cross(p[i], p[(i + 1) % 4], p[(i + 2) % 4]))); return s.every((v) => v === s[0] && v !== 0); }
function polyArea(p: Pt[]) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }

/* ───────── 원근 변환 (종이 mm → 사진 픽셀) ───────── */

export function homography(src: Pt[], dst: Pt[]): (p: Pt) => Pt {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) { // 가우스 소거
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 9; j++) A[r][j] -= k * A[c][j];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return ({ x, y }) => {
    const z = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / z, y: (h[3] * x + h[4] * y + h[5]) / z };
  };
}

/* ───────── 3·4. 방향·코드·칸 읽기 ───────── */

function at(g: Gray, p: Pt): number {
  const x = Math.round(p.x), y = Math.round(p.y);
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return 255;
  return g.px[y * g.w + x];
}

/** 종이 좌표 원 안쪽의 평균 밝기 */
function diskMean(g: Gray, T: (p: Pt) => Pt, c: Pt, r: number): number {
  let s = 0, k = 0;
  const step = r / 4;
  for (let dy = -r; dy <= r + 1e-9; dy += step) for (let dx = -r; dx <= r + 1e-9; dx += step) {
    if (dx * dx + dy * dy > r * r) continue;
    s += at(g, T({ x: c.x + dx, y: c.y + dy })); k++;
  }
  return s / k;
}

/** 종이 좌표 원둘레의 밝기 중앙값 (칸을 넘치게 칠한 부분이 조금 있어도 중앙값은 종이 색) */
function ringMedian(g: Gray, T: (p: Pt) => Pt, c: Pt, r: number): number {
  const v: number[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    v.push(at(g, T({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })));
  }
  return median(v);
}

function rectMean(g: Gray, T: (p: Pt) => Pt, x: number, y: number, w: number, h: number): number {
  let s = 0, k = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 4; j++) { s += at(g, T({ x: x + (w * i) / 8, y: y + (h * j) / 4 })); k++; }
  return s / k;
}

type Fit = { T: (p: Pt) => Pt; corners: Pt[]; white: number; black: number; contrast: number };

/** 네 점이 진짜 답안지 모서리인지 확인하고, 어느 점이 종이의 왼쪽 위인지(막대가 가장 어둡게 읽히는 방향) 정한다 */
function fitQuad(g: Gray, quad: Pt[]): Fit | null {
  const sheet = CORNERS.map(([x, y]) => ({ x, y }));
  let best: Fit | null = null, bestBar = 0;
  for (let k = 0; k < 4; k++) {
    const dst = [0, 1, 2, 3].map((i) => quad[(i + k) % 4]);
    const t = homography(sheet, dst);
    const w = median([[105, 8], [105, 289], [5, 150], [205, 150], [105, 47]].map(([x, y]) => at(g, t({ x, y }))));
    const b = median(sheet.map((p) => diskMean(g, t, p, MARK * 0.3)));
    const bar = (w - rectMean(g, t, BAR.x + 2, BAR.y + 1.2, BAR.w - 4, BAR.h - 2.4)) / Math.max(20, w - b);
    if (bar > bestBar) { bestBar = bar; best = { T: t, corners: dst, white: w, black: b, contrast: Math.max(0.25, (w - b) / Math.max(1, w)) }; }
  }
  return best && bestBar >= 0.5 && best.white - best.black >= 40 ? best : null;
}

/** 시험 확인 코드: 각 칸을 바로 위·아래 흰 종이와 비교해 다른 비트 수 */
function codeMismatch(g: Gray, f: Fit, examId: string): number {
  const want = examCode(examId);
  let errors = 0;
  codeCells().forEach((p, i) => {
    const v = diskMean(g, f.T, p, CODE.size * 0.25);
    const paper = Math.max(at(g, f.T({ x: p.x, y: p.y - CODE.size })), at(g, f.T({ x: p.x, y: p.y + CODE.size })));
    const on = (paper - v) / Math.max(20, paper * f.contrast) > 0.5 ? 1 : 0;
    if (on !== ((want >> i) & 1)) errors++;
  });
  return errors;
}

export function scanSheet(g: Gray, layout: Layout, examId: string): ScanResult {
  const quads = findQuads(g);
  if (!quads.length) return { ok: false, msg: '답안지 네 모서리의 검은 네모를 찾지 못했어요. 종이 전체가 나오게, 밝은 곳에서 다시 찍어 주세요.' };
  let fit: Fit | null = null, codeErrors = 0, sawSheet = false;
  for (const q of quads) {
    const f = fitQuad(g, q);
    if (!f) continue;
    sawSheet = true;
    const e = codeMismatch(g, f, examId);
    if (e <= 2) { fit = f; codeErrors = e; break; }
  }
  if (!fit) {
    return sawSheet
      ? { ok: false, msg: '이 시험의 답안지가 아니에요. 지금 푸는 시험의 OMR 답안지를 찍어 주세요.' }
      : { ok: false, msg: '답안지 방향을 알아보지 못했어요. 그림자가 지지 않게, 종이를 평평하게 놓고 다시 찍어 주세요.' };
  }
  const T = fit.T, contrast = fit.contrast, corners = fit.corners;

  // 칸 읽기: 칸 안쪽(테두리 제외) 평균 밝기 → 0(흰 종이) ~ 1(검게 꽉 참)
  const fill = layout.bubbles.map((row) => row.map((p) => {
    const v = diskMean(g, T, p, layout.r * 0.55);
    const paper = ringMedian(g, T, p, layout.r * 1.32); // 칸 바로 바깥 흰 종이 밝기 (그림자 경계에도 강함)
    return Math.max(0, Math.min(1, (paper - v) / Math.max(20, paper * contrast)));
  }));
  const answers: number[] = [];
  const flags: Flag[] = [];
  fill.forEach((f) => {
    const order = f.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
    const [s1, i1] = order[0];
    const s2 = order[1]?.[0] ?? 0;
    if (s1 < 0.3) { answers.push(0); flags.push(s1 > 0.18 ? 'unsure' : 'blank'); return; }
    if (s2 >= 0.3) { answers.push(0); flags.push('multi'); return; }
    answers.push(i1 + 1);
    flags.push(s1 < 0.42 || s2 > 0.18 ? 'unsure' : 'ok');
  });
  return { ok: true, answers, flags, fill, corners, toImage: T, codeErrors };
}

function median(v: number[]) { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

/** 확인용: 종이 부분만 반듯하게 편 이미지 (px/mm 배율) */
export function rectify(g: Gray, T: (p: Pt) => Pt, scale = 2): { w: number; h: number; rgba: Uint8ClampedArray } {
  const w = Math.round(PAGE.w * scale), h = Math.round(PAGE.h * scale);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = at(g, T({ x: (x + 0.5) / scale, y: (y + 0.5) / scale }));
    const i = (y * w + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
  }
  return { w, h, rgba };
}
