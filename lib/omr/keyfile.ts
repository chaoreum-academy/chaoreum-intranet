import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { CIRCLE, parseAnswer } from './engine';

/**
 * 강사가 올린 시험지 파일(엑셀·PDF)에서 정답과 문항정보를 뽑는다.
 * 결과는 기존 「정답」「문항정보」 입력칸에 그대로 채워지고, 강사가 확인한 뒤 저장한다.
 *
 * - 엑셀: '번호'와 '정답' 머리글이 있는 표를 찾아 서버에서 바로 읽는다 (AI 사용 안 함, 무료).
 *         표가 세로(번호·정답 열)든 가로(번호 줄·정답 줄)든 읽는다.
 * - PDF, 또는 표를 못 찾은 엑셀: Claude API로 정답표를 읽는다 (ANTHROPIC_API_KEY 필요).
 */

export type KeyItem = { no: number; answer: number; area: string; concept: string; fix: string };
export type KeyResult = {
  ok: true;
  via: 'excel' | 'ai';
  choices: number;
  items: KeyItem[];
  notes: string[];
} | { ok: false; msg: string };

const ITEM_HEAD = ['번호', '정답', '영역', '핵심 개념', '보완 방법'];

/** 추출 결과 → 화면의 입력칸 값 */
export function toFormValues(r: Extract<KeyResult, { ok: true }>) {
  const items = [...r.items].sort((a, b) => a.no - b.no);
  const n = items.length ? items[items.length - 1].no : 0;
  const key = Array.from({ length: n }, (_, i) => items.find((x) => x.no === i + 1)?.answer ?? 0);
  const answers = key.map((a) => (a ? CIRCLE.charAt(a - 1) : '?')).join('');
  const hasInfo = items.some((x) => x.area || x.concept || x.fix);
  const tsv = hasInfo
    ? [ITEM_HEAD.join('\t'), ...items.map((x) => [x.no, x.answer ? CIRCLE.charAt(x.answer - 1) : '', x.area, x.concept, x.fix].map(clean).join('\t'))].join('\n')
    : '';
  const missing = key.map((a, i) => (a ? 0 : i + 1)).filter(Boolean);
  return { n, answers, items: tsv, missing };
}

function clean(v: unknown): string {
  return String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

const norm = (v: unknown) => clean(v).replace(/\s+/g, '');
const isNoHead = (v: unknown) => /^(번호|문항|문항번호|문번)$/.test(norm(v));
const isAnsHead = (v: unknown) => /^(정답|답|정답번호)$/.test(norm(v));
const COLS: [RegExp, keyof KeyItem][] = [[/^영역$/, 'area'], [/^(핵심개념|개념)$/, 'concept'], [/^(보완방법|보완)$/, 'fix']];

function oneAnswer(v: unknown): number {
  const a = parseAnswer(clean(v));
  return a.length === 1 ? a[0] : 0; // 복수 정답·빈칸은 0 → 강사가 확인
}

/* ───────── 엑셀 ───────── */

export function readExcelKey(buf: ArrayBuffer): KeyResult | null {
  const wb = XLSX.read(buf, { type: 'array' });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const r = vertical(rows) ?? horizontal(rows);
    if (r && r.length) {
      return { ok: true, via: 'excel', choices: Math.max(5, ...r.map((x) => x.answer)), items: r, notes: [`엑셀 「${name}」 시트의 정답표를 읽었습니다.`] };
    }
  }
  return null;
}

/** 번호 | 정답 | 영역 … 처럼 열로 된 표 */
function vertical(rows: unknown[][]): KeyItem[] | null {
  for (let h = 0; h < Math.min(rows.length, 30); h++) {
    const head = rows[h] ?? [];
    const ci = head.findIndex(isNoHead);
    const ai = head.findIndex(isAnsHead);
    if (ci < 0 || ai < 0) continue;
    const extra: Partial<Record<keyof KeyItem, number>> = {};
    head.forEach((c, i) => { const hit = COLS.find(([re]) => re.test(norm(c))); if (hit) extra[hit[1]] = i; });
    const items: KeyItem[] = [];
    for (const r of rows.slice(h + 1)) {
      const no = Number(norm(r?.[ci]));
      if (!Number.isInteger(no) || no < 1 || no > 200) { if (items.length) break; continue; }
      items.push({
        no, answer: oneAnswer(r[ai]),
        area: clean(extra.area !== undefined ? r[extra.area] : ''),
        concept: clean(extra.concept !== undefined ? r[extra.concept] : ''),
        fix: clean(extra.fix !== undefined ? r[extra.fix] : ''),
      });
    }
    if (items.length) return items;
  }
  return null;
}

/** 번호 1 2 3 … / 정답 ③ ① ④ … 처럼 줄로 된 표 (여러 묶음 가능) */
function horizontal(rows: unknown[][]): KeyItem[] | null {
  const items: KeyItem[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i] ?? [];
    const k = r.findIndex(isNoHead);
    if (k < 0) continue;
    const ansRow = rows.slice(i + 1, i + 3).find((x) => isAnsHead(x?.[k]));
    if (!ansRow) continue;
    for (let c = k + 1; c < r.length; c++) {
      const no = Number(norm(r[c]));
      if (Number.isInteger(no) && no >= 1 && no <= 200) items.push({ no, answer: oneAnswer(ansRow[c]), area: '', concept: '', fix: '' });
    }
  }
  return items.length ? items : null;
}

/** 엑셀 → AI에게 줄 텍스트 (시트별 CSV) */
export function excelAsText(buf: ArrayBuffer): string {
  const wb = XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map((n) => `### 시트: ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })).join('\n\n').slice(0, 400_000);
}

/* ───────── AI (Claude) ───────── */

const SCHEMA = {
  type: 'object',
  properties: {
    found_answer_key: { type: 'boolean', description: '파일 안에서 정답표(정답 목록)를 찾았는가' },
    choices: { type: 'integer', description: '선택지 수 (보통 5)' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          no: { type: 'integer' },
          answer: { type: 'integer', description: '정답 번호 1~9. 정답표에 없거나 복수 정답이면 0' },
          area: { type: 'string', description: '영역 (예: 현대시, 문법). 모르면 빈 문자열' },
          concept: { type: 'string', description: '핵심 개념 한 줄. 모르면 빈 문자열' },
          fix: { type: 'string', description: '파일에 보완 방법이 적혀 있을 때만, 아니면 빈 문자열' },
        },
        required: ['no', 'answer', 'area', 'concept', 'fix'],
        additionalProperties: false,
      },
    },
    notes: { type: 'array', items: { type: 'string' }, description: '강사가 확인해야 할 점 (한국어, 짧게)' },
  },
  required: ['found_answer_key', 'choices', 'items', 'notes'],
  additionalProperties: false,
} as const;

const PROMPT = `첨부한 것은 학원 강사가 만든 복습테스트 시험지 파일입니다. 이 파일로 학생용 OMR 답안지와 자동 채점을 만듭니다.

할 일:
1. 파일 안의 정답표(「정답」「빠른 정답」「해설」 등)를 찾아 문항 번호별 정답 번호를 옮겨 적습니다. ①②③④⑤ 같은 원문자는 1~5로 바꿉니다.
2. 정답은 반드시 파일에 적힌 정답표에서만 가져옵니다. 문제를 직접 풀어서 정답을 만들지 마세요. 정답표에 없는 문항, 복수 정답, 서술형 문항은 answer를 0으로 두고 notes에 적습니다.
3. 문항마다 영역(area)과 핵심 개념(concept)을 짧게 적습니다. 파일에 적혀 있으면 그대로, 없으면 문제 내용을 보고 짧게 붙입니다(예: area "현대시", concept "화자의 정서와 태도"). fix는 파일에 보완 방법이 적혀 있을 때만 채웁니다.
4. 문항 번호는 시험지에 있는 객관식 문항 전체를 빠짐없이, 번호 순서대로 적습니다.
5. 정답표를 찾지 못했으면 found_answer_key를 false로 하고 items는 비워 둡니다.`;

export async function readKeyWithAI(file: { kind: 'pdf'; base64: string } | { kind: 'text'; text: string }): Promise<KeyResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, msg: 'PDF를 읽으려면 Vercel 환경변수에 ANTHROPIC_API_KEY를 넣어야 합니다. 그 전에는 엑셀 정답표를 올리거나 정답을 직접 입력해 주세요.' };
  }
  const client = new Anthropic();
  const source = file.kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.base64 } }
    : { type: 'text', text: '아래는 시험지 엑셀 파일의 내용(시트별 CSV)입니다.\n\n' + file.text };

  // 안전 분류기가 거절하면 서버가 다른 모델로 이어서 처리하도록 fallbacks: "default"를 켠다.
  const params = {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [source, { type: 'text', text: PROMPT }] }],
  };
  // fallbacks는 SDK 버전에 따라 타입에 아직 없을 수 있어 요청 객체만 느슨하게 넘긴다 (응답은 아래에서 직접 확인)
  let res: { stop_reason?: string | null; content: { type: string; text?: string }[] };
  try {
    res = (await client.beta.messages.create(params as any)) as unknown as typeof res;
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, msg: 'AI 사용량이 잠시 많습니다. 1분 뒤 다시 시도해 주세요.' };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, msg: '파일을 AI가 읽지 못했습니다: ' + e.message };
    if (e instanceof Anthropic.APIError) return { ok: false, msg: `AI 연결 오류 (${e.status ?? '네트워크'}): ${e.message}` };
    throw e;
  }
  if (res.stop_reason === 'refusal') return { ok: false, msg: 'AI가 이 파일 처리를 거절했습니다. 정답을 직접 입력해 주세요.' };
  if (res.stop_reason === 'max_tokens') return { ok: false, msg: '문항이 너무 많아 AI 응답이 잘렸습니다. 파일을 나눠 올려 주세요.' };
  const text = res.content.map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('');
  let out: { found_answer_key: boolean; choices: number; items: KeyItem[]; notes: string[] };
  try { out = JSON.parse(text); } catch { return { ok: false, msg: 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.' }; }
  if (!out.found_answer_key || !out.items?.length) return { ok: false, msg: '파일에서 정답표를 찾지 못했습니다.' + (out.notes?.length ? '\n' + out.notes.join('\n') : '') };

  const seen = new Set<number>();
  const items = out.items
    .filter((x) => Number.isInteger(x.no) && x.no >= 1 && x.no <= 200 && !seen.has(x.no) && seen.add(x.no))
    .map((x) => ({ no: x.no, answer: x.answer >= 1 && x.answer <= 9 ? x.answer : 0, area: clean(x.area), concept: clean(x.concept), fix: clean(x.fix) }));
  const choices = Math.min(9, Math.max(2, out.choices || 5, ...items.map((x) => x.answer)));
  return { ok: true, via: 'ai', choices, items, notes: ['AI가 읽은 결과입니다. 정답을 한 번 확인해 주세요.', ...(out.notes ?? [])] };
}
