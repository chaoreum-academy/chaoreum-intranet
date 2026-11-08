import { parseAnswer } from './engine';

/** 기존 '문항정보' 탭 열 이름 → DB 칸 */
const COLS: [string, string][] = [
  ['번호', 'no'], ['정답', 'answer'], ['영역', 'area'], ['핵심개념', 'concept'], ['보완방법', 'fix'],
  ['문제유형', 'qtype'], ['출처', 'source'], ['선지별함정', 'traps'], ['과목', 'subject'], ['세부·갈래', 'detail'], ['형식', 'format'],
];

export type ItemRow = { no: number; area: string | null; concept: string | null; fix: string | null; qtype: string | null; source: string | null; traps: string | null; subject: string | null; detail: string | null; format: string | null };

/**
 * 문항정보 붙여넣기 해석. 기존 시트의 '문항정보' 탭을 머리글째 복사하면 열 이름으로 맞추고,
 * 머리글이 없으면 번호·정답·영역·핵심 개념·보완 방법… 순서로 읽는다. (반·시험명 열은 무시)
 */
export function parseItems(text: string): { items: ItemRow[]; key: number[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.split('\t').map((c) => c.trim())).filter((r) => r.some(Boolean));
  const errors: string[] = [];
  if (!lines.length) return { items: [], key: [], errors };
  let map: Record<string, number> = {};
  let start = 0;
  const headIdx = lines.findIndex((r) => r.some((c) => c.replace(/\s+/g, '') === '번호'));
  if (headIdx >= 0 && headIdx < 5) {
    lines[headIdx].forEach((c, i) => {
      const hit = COLS.find(([k]) => k === c.replace(/\s+/g, ''));
      if (hit) map[hit[1]] = i;
    });
    start = headIdx + 1;
  } else {
    COLS.forEach(([, f], i) => { map[f] = i; });
  }
  const items: ItemRow[] = [];
  const key: number[] = [];
  const get = (r: string[], f: string) => (map[f] !== undefined ? r[map[f]] || null : null);
  for (const r of lines.slice(start)) {
    const no = Number(get(r, 'no'));
    if (!Number.isInteger(no) || no < 1) { errors.push(`번호를 읽지 못한 줄: ${r.join(' ').slice(0, 30)}`); continue; }
    items.push({
      no, area: get(r, 'area'), concept: get(r, 'concept'), fix: get(r, 'fix'), qtype: get(r, 'qtype'),
      source: get(r, 'source'), traps: get(r, 'traps'), subject: get(r, 'subject'), detail: get(r, 'detail'), format: get(r, 'format'),
    });
    const a = parseAnswer(get(r, 'answer') || '')[0];
    if (a) key[no - 1] = a;
  }
  return { items, key, errors };
}
