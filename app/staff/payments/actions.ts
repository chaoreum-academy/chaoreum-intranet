'use server';
import { revalidatePath } from 'next/cache';
import { requireRole, BRANCH_ADMIN, back } from '@/lib/auth';
import { branchScope } from '@/lib/branch';

const P = '/staff/payments';

/** 처리 후 돌아갈 주소 (보던 달·필터 유지) */
function ret(form: FormData): string {
  const r = String(form.get('ret') || '');
  return r.startsWith(P) ? r : P;
}
const won = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(/[^\d-]/g, '')) || 0;
const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** 반별 월 수강료 저장 (반 정보 수정 권한 = 지점 실장 이상) */
export async function setFees(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const R = ret(form);
  let saved = 0, denied = 0;
  for (const [k, v] of Array.from(form.entries())) {
    if (!k.startsWith('fee_')) continue;
    const raw = String(v).trim();
    const fee = raw === '' ? null : won(v);
    const { data, error } = await me.sb.from('classes').update({ monthly_fee: fee }).eq('id', k.slice(4)).select('id');
    if (error) back(R, 'err', error.message);
    if (data?.length) saved++; else denied++;
  }
  revalidatePath(P);
  back(R, denied ? 'err' : 'ok', `수강료 ${saved}개 반 저장` + (denied ? `\n${denied}개 반은 권한이 없어 저장하지 못했습니다 (지점 실장 이상).` : ''));
}

/** 그 달에 다니는 학생에게 반 수강료로 청구서 일괄 생성 (이미 있는 청구서는 건너뜀) */
export async function generateMonthly(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const R = ret(form);
  const month = String(form.get('month') || '');
  if (!isMonth(month)) back(R, 'err', '청구할 달을 골라 주세요.');
  const due = String(form.get('due_date') || '') || null;
  const scope = await branchScope(me);
  let cq = me.sb.from('classes').select('id, name, monthly_fee').eq('active', true).not('monthly_fee', 'is', null);
  if (scope.current) cq = cq.eq('branch_id', scope.current);
  const picked = form.getAll('class_id').map(String).filter(Boolean);
  if (picked.length) cq = cq.in('id', picked);
  const { data: classes, error: ce } = await cq;
  if (ce) back(R, 'err', ce.message);
  if (!classes?.length) back(R, 'err', '수강료가 입력된 반이 없습니다. 아래 「반별 월 수강료」를 먼저 입력하세요.');

  const start = `${month}-01`, end = lastDay(month);
  const { data: enr, error: ee } = await me.sb.from('enrollments')
    .select('student_id, class_id, start_date, end_date, students!inner(status)')
    .in('class_id', classes.map((c) => c.id)).lte('start_date', end).or(`end_date.is.null,end_date.gte.${start}`)
    .eq('students.status', 'active');
  if (ee) back(R, 'err', ee.message);
  const m = Number(month.slice(5));
  const rows = (enr ?? []).map((e: any) => {
    const c = classes.find((x) => x.id === e.class_id)!;
    return { student_id: e.student_id, class_id: c.id, month, title: `${m}월 수강료 · ${c.name}`, amount: c.monthly_fee as number, due_date: due };
  });
  if (!rows.length) back(R, 'err', '그 달에 다니는 학생이 없습니다.');
  const { data: made, error } = await me.sb.from('bills').upsert(rows, { onConflict: 'student_id,month,title', ignoreDuplicates: true }).select('id');
  if (error) back(R, 'err', error.code === '42501' ? '청구서를 만들 권한이 없습니다.' : error.message);
  revalidatePath(P);
  back(R, 'ok', `${month} 청구서 ${made?.length ?? 0}건을 만들었습니다.` + (rows.length - (made?.length ?? 0) ? ` (이미 있던 ${rows.length - (made?.length ?? 0)}건은 건너뜀)` : ''));
}

/** 개별 청구 (교재비·특강비 등) */
export async function addBill(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const R = ret(form);
  const month = String(form.get('month') || '');
  const title = String(form.get('title') || '').trim();
  const amount = won(form.get('amount'));
  const discount = won(form.get('discount'));
  const student_id = String(form.get('student_id') || '');
  if (!student_id || !title || !isMonth(month)) back(R, 'err', '학생·달·항목을 입력해 주세요.');
  if (amount <= 0) back(R, 'err', '청구 금액을 입력해 주세요.');
  if (discount < 0 || discount > amount) back(R, 'err', '할인은 청구 금액보다 클 수 없습니다.');
  const { error } = await me.sb.from('bills').insert({
    student_id, month, title, amount, discount,
    class_id: String(form.get('class_id') || '') || null,
    due_date: String(form.get('due_date') || '') || null,
    memo: String(form.get('memo') || '').trim() || null,
  });
  if (error) back(R, 'err', error.code === '23505' ? '같은 달에 같은 이름의 청구 항목이 이미 있습니다.' : error.code === '42501' ? '이 학생의 청구서를 만들 권한이 없습니다.' : error.message);
  revalidatePath(P);
  back(R, 'ok', `청구서를 만들었습니다: ${title} ${amount.toLocaleString('ko-KR')}원`);
}

/** 할인·납기·메모 수정, 청구 취소/되살리기 */
export async function updateBill(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const R = ret(form);
  const id = String(form.get('id'));
  const patch: Record<string, unknown> = {};
  if (form.has('cancelled')) patch.cancelled = form.get('cancelled') === 'true';
  if (form.has('discount')) patch.discount = won(form.get('discount'));
  if (form.has('due_date')) patch.due_date = String(form.get('due_date') || '') || null;
  if (form.has('memo')) patch.memo = String(form.get('memo') || '').trim() || null;
  const { data, error } = await me.sb.from('bills').update(patch).eq('id', id).select('id');
  if (error) back(R, 'err', error.code === '23514' ? '할인은 청구 금액보다 클 수 없습니다.' : error.message);
  if (!data?.length) back(R, 'err', '수정할 권한이 없습니다.');
  revalidatePath(P);
  back(R, 'ok', patch.cancelled === true ? '청구를 취소했습니다.' : patch.cancelled === false ? '청구를 되살렸습니다.' : '저장했습니다.');
}

/** 수납(또는 환불) 기록 — 현장 카드 단말기·현금·계좌이체 */
export async function recordPayment(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const R = ret(form);
  const bill_id = String(form.get('bill_id'));
  const refund = form.get('kind') === 'refund';
  const amount = Math.abs(won(form.get('amount'))) * (refund ? -1 : 1);
  const method = String(form.get('method') || '');
  if (!amount) back(R, 'err', '금액을 입력해 주세요.');
  if (!['card', 'cash', 'transfer'].includes(method)) back(R, 'err', '결제 수단을 골라 주세요.');
  const { error } = await me.sb.from('payments').insert({
    bill_id, amount, method,
    paid_at: String(form.get('paid_at') || '') || undefined,
    memo: String(form.get('memo') || '').trim() || null,
  });
  if (error) back(R, 'err', error.code === '42501' ? '수납을 기록할 권한이 없습니다.' : error.message);
  revalidatePath(P);
  back(R, 'ok', `${refund ? '환불' : '수납'} ${Math.abs(amount).toLocaleString('ko-KR')}원을 기록했습니다.`);
}

/** 잘못 입력한 수납 기록 지우기 (변경 기록에는 남음) */
export async function deletePayment(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const R = ret(form);
  const { data, error } = await me.sb.from('payments').delete().eq('id', String(form.get('id'))).select('id');
  if (error) back(R, 'err', error.message);
  if (!data?.length) back(R, 'err', '지울 권한이 없습니다.');
  revalidatePath(P);
  back(R, 'ok', '수납 기록을 지웠습니다.');
}
