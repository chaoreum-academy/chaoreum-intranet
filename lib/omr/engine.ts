/**
 * OMR 채점·분석 엔진
 *
 * 기존 Apps Script(legacy/omr/Code.gs, 심진섭T 복습테스트 채점기)의 계산 규칙을 그대로 옮긴 것.
 * 문장 템플릿은 원본에서 자동 추출(templates.json)했고, `npm run test:omr`이
 * 원본 함수와 이 파일의 결과가 글자 하나까지 같은지 수천 건 무작위로 비교합니다.
 *
 * 규칙을 바꿀 때는 원본과 달라진다는 뜻이므로, 테스트 결과를 보고 의도한 변경인지 확인하세요.
 */
import T from './templates.json';

export const CIRCLE = '①②③④⑤⑥⑦⑧⑨';

export type Graded = { n: number; score: number; ox: number[]; wrong: number[] };
export type ItemMeta = { area: string; concept: string; fix: string };
export type ItemInfo = Record<number, ItemMeta>;
export type AreaStat = { area: string; total: number; wrong: number; nums: number[] };

/* ───────── 기본 ───────── */

export function hangul(s: unknown): string {
  return String(s || '').replace(/[^가-힣]/g, '');
}

/** 100점 만점 환산: 맞힌 개수 ÷ 문항 수 (원본 pts와 동일, 부동소수 반올림까지 같게 JS로만 계산) */
export function pts(score: number, n: number): number {
  return Math.round((Number(score) / (Number(n) || 1)) * 100);
}

/** 정답 문자열 → 번호 배열. 원본은 ①②③만 받았고, 여기서는 숫자(31425)도 받는다. */
export function parseAnswer(s: string): number[] {
  return String(s || '')
    .split('')
    .map((c) => {
      const k = CIRCLE.indexOf(c);
      if (k >= 0) return k + 1;
      return /[1-9]/.test(c) ? Number(c) : 0;
    })
    .filter((x) => x > 0);
}

export function answerText(answers: (number | null | undefined)[], n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(answers[i] ? CIRCLE.charAt((answers[i] as number) - 1) : '-');
  return out.join('');
}

export function grade(key: number[], answers: (number | null | undefined)[], n = key.length): Graded {
  const ox: number[] = [];
  const wrong: number[] = [];
  for (let i = 0; i < n; i++) {
    const ok = Number(answers[i]) === key[i];
    ox.push(ok ? 1 : 0);
    if (!ok) wrong.push(i + 1);
  }
  return { n, score: n - wrong.length, ox, wrong };
}

/** 저장된 OX 문자열("10110")에서 채점 결과 복원 (원본 getReport와 동일) */
export function fromOx(ox: string): Graded {
  const arr = String(ox).split('').map(Number);
  const g: Graded = { n: arr.length, ox: arr, score: arr.filter(Boolean).length, wrong: [] };
  arr.forEach((o, i) => { if (!o) g.wrong.push(i + 1); });
  return g;
}

/* ───────── 영역 통계 ───────── */

export function areaStats(info: ItemInfo, g: Graded): AreaStat[] {
  const st: Record<string, AreaStat> = {};
  const order: string[] = [];
  for (let i = 1; i <= g.n; i++) {
    const a = (info[i] && info[i].area) || '';
    if (!a) continue; // 문항정보가 없는 문항은 영역 통계에 넣지 않는다
    if (!st[a]) { st[a] = { area: a, total: 0, wrong: 0, nums: [] }; order.push(a); }
    st[a].total++;
    if (!g.ox[i - 1]) { st[a].wrong++; st[a].nums.push(i); }
  }
  return order.map((a) => st[a]);
}

/** 부족한 영역 순위: 문항 3개 이상 영역 우선 → 오답률 → 오답 수 */
export function weakAreas(stats: AreaStat[]): AreaStat[] {
  return stats.filter((s) => s.wrong > 0).sort((a, b) => {
    const sa = a.total < 3 ? 1 : 0, sb = b.total < 3 ? 1 : 0;
    if (sa !== sb) return sa - sb;
    const ra = a.wrong / a.total, rb = b.wrong / b.total;
    if (ra !== rb) return rb - ra;
    return b.wrong - a.wrong;
  });
}

/** 리포트 영역 막대: 정답률 + '보완 필요'(60% 미만이면서 같은 반 평균보다 10%p 넘게 낮음) */
export function areaRates(info: ItemInfo, g: Graded, peerOx: string[]) {
  const avg: Record<string, { t: number; c: number }> = {};
  peerOx.forEach((s) => {
    const pox = String(s).split('').map(Number);
    for (let i = 1; i <= pox.length; i++) {
      const a = (info[i] && info[i].area) || '';
      if (!a) continue;
      avg[a] = avg[a] || { t: 0, c: 0 };
      avg[a].t++; avg[a].c += pox[i - 1] ? 1 : 0;
    }
  });
  return areaStats(info, g).map((s) => {
    const rate = Math.round(((s.total - s.wrong) / s.total) * 100);
    const ar = avg[s.area] ? (avg[s.area].c / avg[s.area].t) * 100 : rate;
    return { area: s.area, rate, need: rate < 60 && ar - rate > 10 };
  });
}

/* ───────── 리포트 코멘트 ───────── */

function level(rate: number): number {
  if (rate === 0) return 0;
  if (rate <= 10) return 1;
  if (rate <= 20) return 2;
  if (rate <= 30) return 3;
  if (rate <= 50) return 4;
  if (rate <= 70) return 5;
  return 6;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick<X>(list: X[], seed: string): X { return list[hash(seed) % list.length]; }

function fill(t: string, v: Record<string, string | number>): string {
  return t.replace(/\{([^}]+)\}/g, (_, k) => (v[k] != null ? String(v[k]) : ''));
}

function uniq(a: string[]): string[] { return a.filter((x, i) => x && a.indexOf(x) === i); }

/** 학생 리포트 코멘트 4~6줄. 같은 학생·같은 시험이면 항상 같은 문장이 나온다. */
export function reportComment(name: string, examName: string, g: Graded, stats: AreaStat[], weak: AreaStat[], info: ItemInfo): string {
  const rate = (g.wrong.length / g.n) * 100;
  const lv = level(rate);
  const seed = hangul(name) + '|' + examName;
  const v = { 시험: examName, 정답률: Math.round((g.score / g.n) * 100) };
  const L = [fill(pick(T.C_FIRST[lv], seed + '|1'), v)];
  const good = stats.filter((s) => s.wrong === 0).map((s) => s.area);
  if (good.length) L.push(fill(pick(T.C_GOOD, seed + '|2'), { 영역: good.join('·') }));
  if (lv === 0) {
    L.push(pick(T.C_KEEP, seed + '|3'));
  } else if (!weak[0]) {
    L.push(fill(pick(T.C_FIX, seed + '|5'), { 보완: T.FIX_DEFAULT }));
  } else {
    const w1 = weak[0];
    const concepts = w1.nums.map((k) => (info[k] && info[k].concept) as string).filter(String);
    L.push(fill(pick(T.C_WEAK1, seed + '|3'), { 영역: w1.area, 번호: w1.nums.join(', '), 개념: uniq(concepts).slice(0, 2).join(', ') || w1.area }));
    if (weak[1]) L.push(fill(pick(T.C_WEAK2, seed + '|4'), { 영역: weak[1].area, 번호: weak[1].nums.join(', ') }));
    const fix = w1.nums.map((k) => (info[k] && info[k].fix) as string).filter(String)[0] || T.FIX_DEFAULT;
    L.push(fill(pick(T.C_FIX, seed + '|5'), { 보완: fix }));
  }
  L.push(pick(T.C_LAST[lv], seed + '|6'));
  return L.join('\n');
}

/* ───────── 학부모 전송용 문자 ───────── */

function callName(name: string): string {
  const h = hangul(name);
  return h.length >= 2 ? h.slice(1) : h;
}

function josaWa(word: string): string {
  const h = hangul(word);
  if (!h) return '와';
  const c = h.charCodeAt(h.length - 1) - 0xac00;
  return c % 28 ? '과' : '와';
}

/**
 * 학부모 문자 문안. 원본은 강사 이름·웹앱 주소가 코드에 고정이었으나
 * 여기서는 시험을 만든 강사 이름과 플랫폼 리포트 주소를 받는다.
 */
export function parentMessage(p: { name: string; teacher: string; guide: string; g: Graded; weak: AreaStat[]; url: string }): string {
  const { name, teacher, guide, g, weak, url } = p;
  const full = hangul(name);
  const rate = (g.wrong.length / g.n) * 100;
  const L = ['안녕하세요. ' + callName(name) + ' 담당 강사 ' + teacher + '입니다.^^'];
  if (guide) {
    const parts = guide.split('|').map((s) => s.trim());
    const chosen = rate <= 20 ? parts[0] : rate <= 50 ? parts[1] : parts[2];
    if (chosen) L.push(chosen);
  }
  L.push(full + ' 학생의 오늘 테스트 결과는 100점 만점에 ' + pts(g.score, g.n) + '점입니다(' + g.n + '문항 중 ' + g.score + '문항 정답).');
  if (!g.wrong.length) {
    L.push('전 문항 정답입니다. 배운 내용을 꼼꼼히 잘 정리하고 있어서 클리닉 시간에 많이 칭찬해 주었습니다.');
  } else {
    let s = '틀린 문항은 ' + g.wrong.join(', ') + '번입니다. ';
    const w1 = weak[0], w2 = weak[1];
    if (w1 && w2) {
      s += '특히 ' + w1.area + '(' + w1.nums.join(', ') + '번)' + josaWa(w1.area) + ' ' + w2.area + '(' + w2.nums.join(', ') + '번) 부분이 부족했는데, ';
    } else if (w1) {
      s += '특히 ' + w1.area + '(' + w1.nums.join(', ') + '번) 부분이 부족했는데, ';
    }
    s += '오늘 클리닉 시간에 틀린 문항을 모두 다시 고치고 풀이까지 해 주었습니다.';
    L.push(s);
    const closing = T.CLOSING as [number, string][];
    for (let i = 0; i < closing.length; i++) {
      if (rate > closing[i][0]) { L.push(closing[i][1]); break; }
    }
  }
  L.push(url);
  return L.join('\n');
}

/** 결과표용 '부족한 영역' 요약: 상위 2개 */
export function weakSummary(weak: AreaStat[]): string {
  return weak.slice(0, 2).map((w) => w.area + '(' + w.nums.join(', ') + '번)').join(', ');
}
