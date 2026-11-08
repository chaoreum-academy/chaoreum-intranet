'use server';
import { revalidatePath } from 'next/cache';
import { requireRole, STAFF, back } from '@/lib/auth';

const STATUSES = ['present', 'late', 'absent', 'early_leave', 'makeup'];

function pathOf(form: FormData) {
  return `/staff/attendance?date=${form.get('date')}&class=${form.get('class_id')}`;
}

/** 한 학생 출결 (버튼 한 번). 출석·지각·보강이면 등원 시각, 조퇴면 하원 시각을 같이 남긴다 */
export async function mark(form: FormData) {
  const me = await requireRole(STAFF);
  const P = pathOf(form);
  const status = String(form.get('status'));
  if (!STATUSES.includes(status)) back(P, 'err', '잘못된 상태입니다.');
  const key = { student_id: String(form.get('student_id')), class_id: String(form.get('class_id')), date: String(form.get('date')) };
  const { data: prev } = await me.sb.from('attendance').select('check_in, check_out').match(key).maybeSingle();
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { ...key, status };
  if (['present', 'late', 'makeup', 'early_leave'].includes(status)) row.check_in = prev?.check_in ?? now;
  if (status === 'absent') { row.check_in = null; row.check_out = null; }
  if (status === 'early_leave') row.check_out = prev?.check_out ?? now;
  const { error } = await me.sb.from('attendance').upsert(row, { onConflict: 'student_id,class_id,date' });
  if (error) back(P, 'err', error.code === '42501' ? '이 반의 출결을 입력할 권한이 없습니다.' : error.message);
  revalidatePath('/staff/attendance');
  revalidatePath('/staff');
  back(P, 'ok', '');
}

export async function checkout(form: FormData) {
  const me = await requireRole(STAFF);
  const P = pathOf(form);
  const { error } = await me.sb.from('attendance').update({ check_out: new Date().toISOString() })
    .match({ student_id: String(form.get('student_id')), class_id: String(form.get('class_id')), date: String(form.get('date')) });
  if (error) back(P, 'err', error.message);
  revalidatePath('/staff/attendance');
  back(P, 'ok', '');
}

export async function saveMemo(form: FormData) {
  const me = await requireRole(STAFF);
  const P = pathOf(form);
  const { error } = await me.sb.from('attendance').update({ memo: String(form.get('memo') || '').trim() || null })
    .match({ student_id: String(form.get('student_id')), class_id: String(form.get('class_id')), date: String(form.get('date')) });
  if (error) back(P, 'err', error.message);
  revalidatePath('/staff/attendance');
  back(P, 'ok', '메모를 저장했습니다.');
}

/** 아직 체크 안 한 학생 전원 출석 */
export async function markAllPresent(form: FormData) {
  const me = await requireRole(STAFF);
  const P = pathOf(form);
  const class_id = String(form.get('class_id')), date = String(form.get('date'));
  const ids = form.getAll('student_id').map(String);
  if (!ids.length) back(P, 'ok', '모두 체크되어 있습니다.');
  const now = new Date().toISOString();
  const { error } = await me.sb.from('attendance').upsert(
    ids.map((student_id) => ({ student_id, class_id, date, status: 'present', check_in: now })),
    { onConflict: 'student_id,class_id,date', ignoreDuplicates: true }
  );
  if (error) back(P, 'err', error.message);
  revalidatePath('/staff/attendance');
  revalidatePath('/staff');
  back(P, 'ok', `${ids.length}명을 출석 처리했습니다.`);
}
