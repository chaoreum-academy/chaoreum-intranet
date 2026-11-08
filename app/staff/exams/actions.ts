'use server';
import { revalidatePath } from 'next/cache';
import { requireRole, STAFF, back, type Me } from '@/lib/auth';
import { parseAnswer } from '@/lib/omr/engine';
import { parseItems } from '@/lib/omr/items';
import { readExcelKey, excelAsText, readKeyWithAI, toFormValues } from '@/lib/omr/keyfile';

export type KeyImport =
  | { ok: true; via: 'excel' | 'ai'; n: number; choices: number; answers: string; items: string; missing: number[]; notes: string[] }
  | { ok: false; msg: string };

/** 시험지 파일(엑셀·PDF) → 정답·문항정보 초안. 저장하지 않고 화면 입력칸만 채운다 (강사가 확인 후 저장) */
export async function importKeyFile(form: FormData): Promise<KeyImport> {
  await requireRole(STAFF);
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { ok: false, msg: '파일을 골라 주세요.' };
  if (file.size > 4 * 1024 * 1024) return { ok: false, msg: '파일이 4MB를 넘습니다. PDF는 「축소」 저장하거나 정답표 쪽만 따로 저장해 올려 주세요.' };
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  try {
    let r;
    if (/\.(xlsx|xls|csv)$/.test(name)) {
      r = readExcelKey(buf) ?? (await readKeyWithAI({ kind: 'text', text: excelAsText(buf) }));
    } else if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      r = await readKeyWithAI({ kind: 'pdf', base64: Buffer.from(buf).toString('base64') });
    } else {
      return { ok: false, msg: '엑셀(.xlsx) 또는 PDF 파일만 올릴 수 있습니다. 한글(HWP)은 PDF로 저장해서 올려 주세요.' };
    }
    if (!r.ok) return r;
    const v = toFormValues(r);
    if (!v.n) return { ok: false, msg: '정답표에서 문항을 찾지 못했습니다.' };
    return { ok: true, via: r.via, choices: r.choices, notes: r.notes, ...v };
  } catch (e: any) {
    console.error('시험지 파일 읽기 오류', e);
    return { ok: false, msg: '파일을 읽는 중 오류가 났습니다: ' + (e?.message ?? e) };
  }
}

/** datetime-local 값(서울 시각) → ISO */
function seoulToIso(v: string): string | null {
  return v ? new Date(v + ':00+09:00').toISOString() : null;
}

function readKey(form: FormData): { key: number[]; items: ReturnType<typeof parseItems> } {
  const items = parseItems(String(form.get('items') || ''));
  let key = parseAnswer(String(form.get('answers') || ''));
  if (!key.length && items.key.length) key = items.key; // 정답을 문항정보에 넣은 경우
  return { key, items };
}

async function saveItems(me: Me, examId: string, items: ReturnType<typeof parseItems>['items'], n: number) {
  const rows = items.filter((r) => r.no <= n).map((r) => ({ exam_id: examId, ...r }));
  await me.sb.from('exam_items').delete().eq('exam_id', examId);
  if (rows.length) {
    const { error } = await me.sb.from('exam_items').insert(rows);
    if (error) throw new Error('문항정보 저장 실패: ' + error.message);
  }
  return rows.length;
}

export async function createExam(form: FormData) {
  const me = await requireRole(STAFF);
  const P = '/staff/exams';
  const class_id = String(form.get('class_id') || '');
  const title = String(form.get('title') || '').trim();
  const choices = Math.min(9, Math.max(2, Number(form.get('choices') || 5)));
  const { key, items } = readKey(form);
  const n = Number(form.get('n_items')) || key.length;
  if (!class_id || !title) back(P, 'err', '반과 시험명을 입력해 주세요.');
  if (!n) back(P, 'err', '정답을 입력해 주세요. 예: ③①④②⑤ 또는 31425');
  if (key.length !== n) back(P, 'err', `문항 수(${n})와 정답 개수(${key.length})가 다릅니다.`);
  if (key.some((k) => !k || k > choices)) back(P, 'err', `정답에 ${choices}지선다를 넘는 번호가 있습니다.`);

  const { data: exam, error } = await me.sb.from('exams').insert({
    class_id, title, n_items: n, choices, guide: String(form.get('guide') || '').trim() || null,
    opens_at: seoulToIso(String(form.get('opens_at') || '')), is_open: form.get('is_open') === 'on',
  }).select('id').single();
  if (error) back(P, 'err', error.code === '23505' ? '이 반에 같은 이름의 시험이 있습니다.' : error.code === '42501' ? '이 반의 시험을 만들 권한이 없습니다.' : error.message);

  const { error: e2 } = await me.sb.from('exam_keys').insert({ exam_id: exam.id, answers: key });
  if (e2) { await me.sb.from('exams').delete().eq('id', exam.id); back(P, 'err', '정답 저장 실패: ' + e2.message); }
  let saved = 0;
  try { saved = await saveItems(me, exam.id, items.items, n); } catch (e: any) { back(`${P}/${exam.id}`, 'err', e.message); }

  revalidatePath(P);
  back(`${P}/${exam.id}`, 'ok', `시험을 만들었습니다. 문항 ${n}개, 문항정보 ${saved}개` + (items.errors.length ? `\n건너뛴 줄 ${items.errors.length}개` : '') +
    (form.get('is_open') === 'on' ? '' : '\n학생에게 보이려면 「열기」를 켜세요.'));
}

export async function setExamFlags(form: FormData) {
  const me = await requireRole(STAFF);
  const id = String(form.get('id'));
  const P = `/staff/exams/${id}`;
  const patch: Record<string, unknown> = {};
  if (form.has('is_open')) patch.is_open = form.get('is_open') === 'true';
  if (form.has('allow_retake')) patch.allow_retake = form.get('allow_retake') === 'true';
  const { error } = await me.sb.from('exams').update(patch).eq('id', id);
  if (error) back(P, 'err', error.message);
  revalidatePath(P);
  back(P, 'ok', '저장했습니다.');
}

export async function updateKey(form: FormData) {
  const me = await requireRole(STAFF);
  const id = String(form.get('id'));
  const P = `/staff/exams/${id}`;
  const { data: exam } = await me.sb.from('exams').select('n_items, choices').eq('id', id).single();
  if (!exam) back(P, 'err', '시험을 찾을 수 없습니다.');
  const { key, items } = readKey(form);
  if (key.length) {
    if (key.length !== exam.n_items) back(P, 'err', `정답 개수(${key.length})가 문항 수(${exam.n_items})와 다릅니다.`);
    const { error } = await me.sb.from('exam_keys').upsert({ exam_id: id, answers: key });
    if (error) back(P, 'err', error.message);
  }
  let saved = -1;
  if (String(form.get('items') || '').trim()) {
    try { saved = await saveItems(me, id, items.items, exam.n_items); } catch (e: any) { back(P, 'err', e.message); }
  }
  revalidatePath(P);
  back(P, 'ok', [key.length ? '정답을 고쳤습니다. 이미 제출한 학생은 아래 「다시 채점」을 누르세요.' : '', saved >= 0 ? `문항정보 ${saved}개를 저장했습니다.` : ''].filter(Boolean).join('\n') || '바뀐 내용이 없습니다.');
}

/** 정답을 고친 뒤 이미 낸 답안 전체 다시 채점 (원본 '이번 주 응답 다시 채점'에 해당). DB 함수가 권한 확인 후 처리 */
export async function regrade(form: FormData) {
  const me = await requireRole(STAFF);
  const id = String(form.get('id'));
  const P = `/staff/exams/${id}`;
  const { data, error } = await me.sb.rpc('regrade_exam', { p_exam: id });
  if (error) back(P, 'err', '다시 채점 실패: ' + error.message);
  revalidatePath(P);
  back(P, 'ok', `제출 ${data}건을 다시 채점했습니다.`);
}
