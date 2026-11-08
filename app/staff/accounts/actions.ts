'use server';
import { revalidatePath } from 'next/cache';
import { requireRole, BRANCH_ADMIN, back } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeStudentNo, tempPassword } from '@/lib/ids';

const P = '/staff/accounts';

async function findUserId(admin: ReturnType<typeof supabaseAdmin>, email: string): Promise<string | undefined> {
  for (let page = 1; page <= 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return undefined;
  }
  return undefined;
}

/** 직원 계정: 본사 관리자만 */
export async function createStaff(form: FormData) {
  const me = await requireRole(['hq_admin']);
  const email = String(form.get('email') || '').trim().toLowerCase();
  const name = String(form.get('name') || '').trim();
  const role = String(form.get('role') || '');
  const branches = form.getAll('branch_id').map(String);
  if (!email.includes('@') || !name) back(P, 'err', '이메일과 이름을 입력해 주세요.');
  if (!['hq_admin', 'branch_manager', 'desk', 'teacher'].includes(role)) back(P, 'err', '역할을 선택해 주세요.');
  if ((role === 'branch_manager' || role === 'desk') && !branches.length) back(P, 'err', '실장·데스크는 담당 지점을 하나 이상 골라야 합니다.');
  const admin = supabaseAdmin();
  const password = tempPassword(10);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) back(P, 'err', error?.message.includes('already') ? '이미 가입된 이메일입니다.' : '생성 실패: ' + error?.message);
  const { error: e2 } = await admin.from('profiles').insert({ id: data.user.id, role, display_name: name });
  if (!e2 && branches.length) await admin.from('staff_branches').insert(branches.map((b) => ({ user_id: data.user.id, branch_id: b })));
  if (e2) { await admin.auth.admin.deleteUser(data.user.id); back(P, 'err', e2.message); }
  void me;
  revalidatePath(P);
  back(P, 'ok', `${name} 계정을 만들었습니다.\n아이디: ${email}  /  임시 비밀번호: ${password}`);
}

export async function setStaffActive(form: FormData) {
  await requireRole(['hq_admin']);
  const { error } = await supabaseAdmin().from('profiles').update({ active: form.get('active') === 'true' }).eq('id', String(form.get('id')));
  if (error) back(P, 'err', error.message);
  revalidatePath(P);
  back(P, 'ok', '저장했습니다.');
}

/** 학부모 계정 + 자녀 연결: 그 학생 지점의 실장·데스크·본사 */
export async function createParent(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const no = normalizeStudentNo(form.get('student_no'));
  const email = String(form.get('email') || '').trim().toLowerCase();
  const name = String(form.get('name') || '').trim();
  const { data: st } = await me.sb.from('students').select('id, name, branch_id').eq('student_no', no).maybeSingle();
  if (!st) back(P, 'err', `학번 ${no} 학생을 찾을 수 없습니다. (관리하는 지점 학생만 연결 가능)`);
  const { data: ok } = await me.sb.rpc('manages_branch', { b: st.branch_id });
  if (!ok) back(P, 'err', '이 학생의 지점을 관리할 권한이 없습니다.');
  if (!email.includes('@') || !name) back(P, 'err', '학부모 이메일과 이름을 입력해 주세요.');

  const admin = supabaseAdmin();
  let password = tempPassword(10);
  let userId: string | undefined;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.data.user) {
    userId = created.data.user.id;
    const { error: e2 } = await admin.from('profiles').insert({ id: userId, role: 'parent', display_name: name });
    if (e2) { await admin.auth.admin.deleteUser(userId); back(P, 'err', e2.message); }
  } else {
    // 이미 가입된 이메일 → 형제 등록일 수 있으니 찾아서 연결만
    userId = await findUserId(admin, email);
    if (!userId) back(P, 'err', '생성 실패: ' + (created.error?.message ?? ''));
    const { data: prof } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
    if (prof?.role !== 'parent') back(P, 'err', '이 이메일은 학부모가 아닌 다른 계정으로 쓰이고 있습니다.');
    password = '';
  }
  const { error: e3 } = await me.sb.from('student_guardians').upsert({ student_id: st.id, user_id: userId, relation: String(form.get('relation') || '') || null });
  if (e3) back(P, 'err', '자녀 연결 실패: ' + e3.message);
  revalidatePath(P);
  back(P, 'ok', password
    ? `${st.name} 학생 학부모 계정을 만들었습니다.\n아이디: ${email}  /  임시 비밀번호: ${password}`
    : `기존 학부모 계정(${email})에 ${st.name} 학생을 연결했습니다.`);
}

/** 직원 이름 바꾸기 (본사 관리자). 알림톡의 '담당 강사 ○○○'에 쓰이는 이름 */
export async function renameStaff(form: FormData) {
  await requireRole(['hq_admin']);
  const name = String(form.get('name') || '').trim();
  if (!name) back(P, 'err', '이름을 입력해 주세요.');
  const { error } = await supabaseAdmin().from('profiles').update({ display_name: name }).eq('id', String(form.get('id')));
  if (error) back(P, 'err', error.message);
  revalidatePath(P);
  back(P, 'ok', `이름을 「${name}」(으)로 바꿨습니다.`);
}
