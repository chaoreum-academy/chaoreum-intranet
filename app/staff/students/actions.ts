'use server';
import { revalidatePath } from 'next/cache';
import { requireRole, BRANCH_ADMIN, back, type Me } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeStudentNo, studentEmail, tempPassword } from '@/lib/ids';

const LIST = '/staff/students';

function schoolLevel(name: string) {
  if (/중(학교)?$/.test(name)) return 'middle';
  if (/고(등학교)?$/.test(name)) return 'high';
  return 'other';
}

async function schoolIds(me: Me, names: string[]): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (!uniq.length) return {};
  await me.sb.from('schools').upsert(uniq.map((name) => ({ name, level: schoolLevel(name) })), { onConflict: 'name', ignoreDuplicates: true });
  const { data } = await me.sb.from('schools').select('id, name').in('name', uniq);
  return Object.fromEntries((data ?? []).map((s) => [s.name, s.id]));
}

function parseGrade(v: unknown): number | null {
  const s = String(v ?? '').replace(/\s+/g, '');
  const m = s.match(/(?:중|고|초)?([1-6])(?:학년)?$/) || s.match(/(?:중|고|초)([1-6])/);
  return m ? Number(m[1]) : null;
}

const clean = (v: unknown) => String(v ?? '').trim() || null;

/* ── 한 명 등록 ── */
export async function addStudent(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const name = String(form.get('name') || '').trim();
  const no = normalizeStudentNo(form.get('student_no'));
  const branch_id = String(form.get('branch_id') || '');
  const school = String(form.get('school') || '').trim();
  if (!name || !branch_id) back(LIST, 'err', '이름과 지점은 꼭 입력해야 합니다.');
  const ids = await schoolIds(me, [school]);
  const { data, error } = await me.sb.from('students').insert({
    name, student_no: no || null, branch_id, school_id: ids[school] ?? null, grade: parseGrade(form.get('grade')),
    phone: clean(form.get('phone')), guardian_name: clean(form.get('guardian_name')), guardian_phone: clean(form.get('guardian_phone')),
  }).select('id').single();
  if (error) back(LIST, 'err', error.code === '23505' ? `학번 ${no}은 이미 등록되어 있습니다.` : '등록 실패: ' + error.message);
  revalidatePath(LIST);
  back(`${LIST}/${data.id}`, 'ok', `${name} 학생을 등록했습니다.`);
}

/* ── 엑셀·명단 가져오기 (미리보기 후 확정) ── */
export type ImportClass = { branch_id: string; name: string; schedule: string };
export type ImportRow = {
  student_no: string; name: string; school: string; grade: string; phone: string;
  guardian_name: string; guardian_phone: string;
  branch_id: string;            // 반 이름의 [지점]에서 읽은 지점 (없으면 빈칸 → 기본 지점)
  classes: ImportClass[];
};
export type ImportResult = { ok: boolean; message: string; added: number; updated: number; enrolled: number; newClasses: string[]; failed: string[] };

export async function importStudentsJson(payload: { branch_id: string; createClasses: boolean; cols: string[]; rows: ImportRow[] }): Promise<ImportResult> {
  const me = await requireRole(BRANCH_ADMIN);
  const res: ImportResult = { ok: false, message: '', added: 0, updated: 0, enrolled: 0, newClasses: [], failed: [] };
  const { rows, cols } = payload;
  const fallback = payload.branch_id;
  if (!rows.length) return { ...res, message: '가져올 학생이 없습니다.' };
  if (rows.length > 3000) return { ...res, message: '한 번에 3,000명까지 가져올 수 있습니다. 나눠서 진행해 주세요.' };
  if (!fallback && rows.some((r) => !r.branch_id)) return { ...res, message: '반 이름에 지점이 없는 학생이 있습니다. 기본 지점을 골라 주세요.' };

  // 쓰이는 지점 모두 권한 확인
  const used = new Set<string>([fallback, ...rows.map((r) => r.branch_id), ...rows.flatMap((r) => r.classes.map((c) => c.branch_id))].filter(Boolean));
  for (const b of Array.from(used)) {
    const { data } = await me.sb.rpc('manages_branch', { b });
    if (!data) return { ...res, message: '권한이 없는 지점이 포함되어 있습니다. 관리하는 지점의 학생만 가져올 수 있습니다.' };
  }

  const has = (c: string) => cols.includes(c);
  const schools = await schoolIds(me, rows.map((r) => r.school));
  const nos = rows.map((r) => normalizeStudentNo(r.student_no)).filter(Boolean);
  const existing: Record<string, { id: string; branch_id: string }> = {};
  for (let i = 0; i < nos.length; i += 300) {
    const { data } = await me.sb.from('students').select('id, student_no, branch_id').in('student_no', nos.slice(i, i + 300));
    (data ?? []).forEach((s) => { existing[s.student_no] = s; });
  }

  const idByRow = new Map<number, string>();
  const branchOfRow = new Map<number, string>();
  // 기존 학생: 파일에 있는 칸만 고친다 (빈 칸으로 지우지 않음, 지점은 유지)
  for (const [i, r] of rows.entries()) {
    const no = normalizeStudentNo(r.student_no);
    const ex = no ? existing[no] : undefined;
    if (!ex) continue;
    const patch: Record<string, unknown> = { name: r.name.trim() };
    if (has('school') && r.school) patch.school_id = schools[r.school.trim()] ?? null;
    if (has('grade') && r.grade) patch.grade = parseGrade(r.grade);
    if (has('phone') && r.phone) patch.phone = r.phone.trim();
    if (has('guardian_name') && r.guardian_name) patch.guardian_name = r.guardian_name.trim();
    if (has('guardian_phone') && r.guardian_phone) patch.guardian_phone = r.guardian_phone.trim();
    const { error } = await me.sb.from('students').update(patch).eq('id', ex.id);
    if (error) res.failed.push(`${no} ${r.name}: ${error.message}`);
    else { res.updated++; idByRow.set(i, ex.id); branchOfRow.set(i, ex.branch_id); }
  }

  // 새 학생: 200명씩, 실패하면 한 명씩
  const fresh = rows.map((r, i) => ({ r, i })).filter(({ r }) => !existing[normalizeStudentNo(r.student_no)]);
  const toRow = (r: ImportRow) => ({
    student_no: normalizeStudentNo(r.student_no) || null, name: r.name.trim(), branch_id: r.branch_id || fallback,
    school_id: schools[r.school.trim()] ?? null, grade: parseGrade(r.grade),
    phone: clean(r.phone), guardian_name: clean(r.guardian_name), guardian_phone: clean(r.guardian_phone),
  });
  for (let k = 0; k < fresh.length; k += 200) {
    const chunk = fresh.slice(k, k + 200);
    const { data, error } = await me.sb.from('students').insert(chunk.map(({ r }) => toRow(r))).select('id');
    if (!error && data) { data.forEach((d, j) => { idByRow.set(chunk[j].i, d.id); branchOfRow.set(chunk[j].i, toRow(chunk[j].r).branch_id); }); res.added += data.length; continue; }
    for (const { r, i } of chunk) {
      const { data: one, error: e1 } = await me.sb.from('students').insert(toRow(r)).select('id').single();
      if (e1) res.failed.push(`${r.student_no || '(학번 없음)'} ${r.name}: ${e1.code === '23505' ? '다른 지점에 이미 등록된 학번' : e1.message}`);
      else { idByRow.set(i, one.id); branchOfRow.set(i, toRow(r).branch_id); res.added++; }
    }
  }

  // 반: (지점, 반 이름, 수업 시간)으로 찾고 없으면 만든다. 같은 이름·다른 시간 반은 "광북1A 일 6시"로 구분
  const wanted = new Map<string, ImportClass>();
  rows.forEach((r, i) => r.classes.forEach((c) => {
    const bid = c.branch_id || branchOfRow.get(i) || r.branch_id || fallback;
    if (bid && c.name) wanted.set(`${bid}|${c.name}|${c.schedule}`, { branch_id: bid, name: c.name.trim(), schedule: c.schedule.trim() });
  }));
  const classId = new Map<string, string>();
  if (wanted.size) {
    const bids = Array.from(new Set(Array.from(wanted.values()).map((c) => c.branch_id)));
    const names = Array.from(new Set(Array.from(wanted.values()).flatMap((c) => [c.name, c.schedule ? `${c.name} ${c.schedule}` : c.name])));
    const { data: found } = await me.sb.from('classes').select('id, name, schedule, branch_id').in('branch_id', bids).in('name', names);
    const pool = found ?? [];
    for (const [key, c] of Array.from(wanted.entries())) {
      const same = pool.find((x) => x.branch_id === c.branch_id && x.name === c.name && (!c.schedule || !x.schedule || x.schedule === c.schedule));
      const alt = c.schedule ? pool.find((x) => x.branch_id === c.branch_id && x.name === `${c.name} ${c.schedule}`) : undefined;
      const hit = same ?? alt;
      if (hit) {
        classId.set(key, hit.id);
        if (c.schedule && !hit.schedule) { await me.sb.from('classes').update({ schedule: c.schedule }).eq('id', hit.id); hit.schedule = c.schedule; }
        continue;
      }
      const label = `${c.name}${c.schedule ? ` (${c.schedule})` : ''}`;
      if (!payload.createClasses) { res.failed.push(`반 「${label}」이 없어 배정하지 않음 (「없는 반 새로 만들기」를 켜면 자동 생성)`); continue; }
      const nameTaken = pool.some((x) => x.branch_id === c.branch_id && x.name === c.name);
      const newName = nameTaken && c.schedule ? `${c.name} ${c.schedule}` : c.name;
      const { data: made, error } = await me.sb.from('classes').insert({ branch_id: c.branch_id, name: newName, schedule: c.schedule || null }).select('id, name, schedule, branch_id').single();
      if (error) res.failed.push(`반 「${label}」 생성 실패: ${error.code === '42501' ? '반 생성은 지점 실장 이상만 가능' : error.message}`);
      else { classId.set(key, made.id); pool.push(made); res.newClasses.push(label); }
    }
  }

  const pairs: { student_id: string; class_id: string }[] = [];
  rows.forEach((r, i) => {
    const sid = idByRow.get(i);
    if (!sid) return;
    r.classes.forEach((c) => {
      const bid = c.branch_id || branchOfRow.get(i) || r.branch_id || fallback;
      const cid = classId.get(`${bid}|${c.name.trim()}|${c.schedule.trim()}`);
      if (cid) pairs.push({ student_id: sid, class_id: cid });
    });
  });
  if (pairs.length) {
    const sids = Array.from(new Set(pairs.map((p) => p.student_id)));
    const active = new Set<string>();
    for (let k = 0; k < sids.length; k += 300) {
      const { data } = await me.sb.from('enrollments').select('student_id, class_id').in('student_id', sids.slice(k, k + 300)).is('end_date', null);
      (data ?? []).forEach((e) => active.add(e.student_id + '|' + e.class_id));
    }
    const seen = new Set<string>();
    const todo = pairs.filter((p) => { const k = p.student_id + '|' + p.class_id; if (active.has(k) || seen.has(k)) return false; seen.add(k); return true; });
    for (let k = 0; k < todo.length; k += 300) {
      const part = todo.slice(k, k + 300);
      const { error } = await me.sb.from('enrollments').insert(part);
      if (error) res.failed.push('반 배정 일부 실패: ' + error.message); else res.enrolled += part.length;
    }
  }

  revalidatePath(LIST);
  revalidatePath('/staff/classes');
  return { ...res, ok: true, message: `새로 등록 ${res.added}명 · 정보 수정 ${res.updated}명 · 반 배정 ${res.enrolled}건` + (res.newClasses.length ? ` · 새 반 ${res.newClasses.length}개` : '') };
}

/* ── 학생 카드에서 쓰는 것 ── */
export async function updateStudent(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const id = String(form.get('id'));
  const P = `${LIST}/${id}`;
  const school = String(form.get('school') || '').trim();
  const ids = await schoolIds(me, [school]);
  const { error } = await me.sb.from('students').update({
    name: String(form.get('name') || '').trim(), student_no: normalizeStudentNo(form.get('student_no')) || null,
    school_id: ids[school] ?? null, grade: parseGrade(form.get('grade')),
    phone: clean(form.get('phone')), guardian_name: clean(form.get('guardian_name')), guardian_phone: clean(form.get('guardian_phone')), memo: clean(form.get('memo')),
  }).eq('id', id);
  if (error) back(P, 'err', error.code === '23505' ? '이미 다른 학생이 쓰는 학번입니다.' : error.message);
  revalidatePath(P);
  back(P, 'ok', '저장했습니다.');
}

export async function setStatus(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const id = String(form.get('id'));
  const P = `${LIST}/${id}`;
  const status = String(form.get('status'));
  if (!['active', 'paused', 'withdrawn'].includes(status)) back(P, 'err', '잘못된 상태입니다.');
  const { error } = await me.sb.from('students').update({ status }).eq('id', id);
  if (error) back(P, 'err', error.message);
  if (status === 'withdrawn') {
    await me.sb.from('enrollments').update({ end_date: new Date().toISOString().slice(0, 10) }).eq('student_id', id).is('end_date', null);
  }
  revalidatePath(P);
  back(P, 'ok', status === 'withdrawn' ? '퇴원 처리했습니다. 수강 중이던 반은 오늘 날짜로 종료되었고, 과거 기록은 그대로입니다.' : '상태를 바꿨습니다.');
}

async function guardStudent(me: Me, id: string, P: string) {
  const { data: st } = await me.sb.from('students').select('id, name, student_no, branch_id, user_id').eq('id', id).maybeSingle();
  if (!st) back(P, 'err', '학생을 찾을 수 없습니다.');
  const { data: ok } = await me.sb.rpc('manages_branch', { b: st.branch_id });
  if (!ok) back(P, 'err', '이 지점 학생의 계정을 관리할 권한이 없습니다.');
  if (!st.student_no) back(P, 'err', '학번이 없는 학생은 로그인 계정을 만들 수 없습니다. 학번을 먼저 입력해 주세요.');
  return st;
}

async function makeAccount(st: { id: string; name: string; student_no: string }) {
  const admin = supabaseAdmin();
  const password = tempPassword();
  const { data, error } = await admin.auth.admin.createUser({ email: studentEmail(st.student_no), password, email_confirm: true });
  if (error || !data.user) return { ok: false as const, error: error?.message.includes('already') ? '이미 같은 학번 계정이 있음' : (error?.message ?? '생성 실패') };
  const { error: e2 } = await admin.from('profiles').insert({ id: data.user.id, role: 'student', display_name: st.name });
  const { error: e3 } = e2 ? { error: null } : await admin.from('students').update({ user_id: data.user.id }).eq('id', st.id);
  if (e2 || e3) { await admin.auth.admin.deleteUser(data.user.id); return { ok: false as const, error: (e2 ?? e3)!.message }; }
  return { ok: true as const, password };
}

export async function createLogin(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const id = String(form.get('id'));
  const P = `${LIST}/${id}`;
  const st = await guardStudent(me, id, P);
  if (st.user_id) back(P, 'err', '이미 로그인 계정이 있습니다. 비밀번호 초기화를 이용하세요.');
  const r = await makeAccount(st);
  if (!r.ok) back(P, 'err', '계정 생성 실패: ' + r.error);
  revalidatePath(P);
  back(P, 'ok', `로그인 계정을 만들었습니다.\n아이디: ${st.student_no}   임시 비밀번호: ${r.password}\n(이 화면을 벗어나면 다시 볼 수 없습니다)`);
}

export async function resetPassword(form: FormData) {
  const me = await requireRole(BRANCH_ADMIN);
  const id = String(form.get('id'));
  const P = `${LIST}/${id}`;
  const st = await guardStudent(me, id, P);
  if (!st.user_id) back(P, 'err', '아직 로그인 계정이 없습니다.');
  const password = tempPassword();
  const { error } = await supabaseAdmin().auth.admin.updateUserById(st.user_id, { password });
  if (error) back(P, 'err', error.message);
  back(P, 'ok', `비밀번호를 초기화했습니다.\n아이디: ${st.student_no}   임시 비밀번호: ${password}`);
}

/** 계정 없는 재원생 일괄 생성 (한 번에 40명씩, 결과 표를 화면에 돌려준다) */
export type BulkResult = { made: { no: string; name: string; password: string }[]; failed: string[]; remaining: number };

export async function createLoginsBulk(branchId: string | null): Promise<BulkResult> {
  const me = await requireRole(BRANCH_ADMIN);
  let q = me.sb.from('students').select('id, name, student_no, branch_id').is('user_id', null).eq('status', 'active').not('student_no', 'is', null).order('name').limit(1000);
  if (branchId) q = q.eq('branch_id', branchId);
  const { data: list } = await q;
  const all = list ?? [];
  const okBranch: Record<string, boolean> = {};
  for (const b of Array.from(new Set(all.map((s) => s.branch_id)))) {
    const { data } = await me.sb.rpc('manages_branch', { b });
    okBranch[b] = !!data;
  }
  const targets = all.filter((s) => okBranch[s.branch_id]);
  const batch = targets.slice(0, 40);
  const made: BulkResult['made'] = [];
  const failed: string[] = [];
  for (let i = 0; i < batch.length; i += 8) {
    const part = batch.slice(i, i + 8);
    const results = await Promise.all(part.map((s) => makeAccount({ id: s.id, name: s.name, student_no: s.student_no! })));
    results.forEach((r, j) => {
      const s = part[j];
      if (r.ok) made.push({ no: s.student_no!, name: s.name, password: r.password });
      else failed.push(`${s.student_no} ${s.name}: ${r.error}`);
    });
  }
  revalidatePath(LIST);
  return { made, failed, remaining: Math.max(0, targets.length - batch.length) };
}
