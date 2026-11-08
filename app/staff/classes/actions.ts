'use server';
import { revalidatePath } from 'next/cache';
import { requireRole, STAFF, back } from '@/lib/auth';

export async function addClass(form: FormData) {
  const me = await requireRole(STAFF);
  const name = String(form.get('name') || '').trim();
  const branch_id = String(form.get('branch_id') || '');
  if (!name || !branch_id) back('/staff/classes', 'err', '반 이름과 지점을 입력해 주세요.');
  const g = Number(String(form.get('grade') || '').replace(/\D/g, ''));
  const { data, error } = await me.sb.from('classes').insert({
    name, branch_id, subject: String(form.get('subject') || '').trim() || null,
    schedule: String(form.get('schedule') || '').trim() || null, grade: g >= 1 && g <= 6 ? g : null,
  }).select('id').single();
  if (error) back('/staff/classes', 'err', error.code === '23505' ? '같은 지점에 같은 이름의 반이 있습니다.' : error.code === '42501' ? '반을 만들 권한이 없습니다. (지점 실장 이상)' : error.message);
  revalidatePath('/staff/classes');
  back(`/staff/classes/${data.id}`, 'ok', `${name} 반을 만들었습니다. 강사와 학생을 배정하세요.`);
}

export async function addTeacher(form: FormData) {
  const me = await requireRole(STAFF);
  const class_id = String(form.get('class_id'));
  const { error } = await me.sb.from('class_teachers').upsert({ class_id, user_id: String(form.get('user_id')), role: String(form.get('role') || 'main') });
  const p = `/staff/classes/${class_id}`;
  if (error) back(p, 'err', error.code === '42501' ? '강사 배정은 지점 실장 이상만 할 수 있습니다.' : error.message);
  revalidatePath(p);
  back(p, 'ok', '강사를 배정했습니다.');
}

export async function removeTeacher(form: FormData) {
  const me = await requireRole(STAFF);
  const class_id = String(form.get('class_id'));
  const p = `/staff/classes/${class_id}`;
  const { error } = await me.sb.from('class_teachers').delete().eq('class_id', class_id).eq('user_id', String(form.get('user_id')));
  if (error) back(p, 'err', error.message);
  revalidatePath(p);
  back(p, 'ok', '강사 배정을 해제했습니다.');
}

export async function enroll(form: FormData) {
  const me = await requireRole(STAFF);
  const class_id = String(form.get('class_id'));
  const p = `/staff/classes/${class_id}`;
  const ids = form.getAll('student_id').map(String).filter(Boolean);
  if (!ids.length) back(p, 'err', '추가할 학생을 선택해 주세요.');
  const start_date = String(form.get('start_date') || '') || new Date().toISOString().slice(0, 10);
  const { error } = await me.sb.from('enrollments').insert(ids.map((student_id) => ({ student_id, class_id, start_date })));
  if (error) back(p, 'err', error.code === '23505' ? '이미 이 반에 다니는 학생이 포함되어 있습니다.' : error.code === '42501' ? '수강 등록 권한이 없습니다.' : error.message);
  revalidatePath(p);
  back(p, 'ok', `${ids.length}명을 반에 추가했습니다.`);
}

/** 반에서 빼기 = 수강 종료일 기록 (삭제하지 않으므로 출결·성적·OMR 기록은 그대로) */
export async function endEnrollment(form: FormData) {
  const me = await requireRole(STAFF);
  const class_id = String(form.get('class_id'));
  const p = `/staff/classes/${class_id}`;
  const { error } = await me.sb.from('enrollments').update({ end_date: new Date().toISOString().slice(0, 10) }).eq('id', String(form.get('id')));
  if (error) back(p, 'err', error.message);
  revalidatePath(p);
  back(p, 'ok', '수강을 종료했습니다. 과거 기록은 유지됩니다.');
}
