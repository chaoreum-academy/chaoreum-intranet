import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole, STAFF } from '@/lib/auth';
import { Flash } from '@/components/Flash';
import { CopyButton } from '@/components/CopyButton';
import { seoulDate } from '@/lib/ids';
import { CIRCLE, areaStats, fromOx, parentMessage, pts, weakAreas, weakSummary, type ItemInfo } from '@/lib/omr/engine';
import { setExamFlags, updateKey, regrade } from '../actions';
import { setExamNotify, sendExamResults, resendOne } from '../../messages/actions';
import { aligoConfigured } from '@/lib/aligo';
import { KeyFileImport } from '../KeyFileImport';

export default async function ExamDetail({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; err?: string } }) {
  const me = await requireRole(STAFF);
  const sb = me.sb;
  const { data: exam } = await sb.from('exams')
    .select('id, title, n_items, choices, is_open, allow_retake, opens_at, guide, class_id, created_by, notify_template_id, notify_auto, classes(name, branches(name))')
    .eq('id', params.id).maybeSingle();
  if (!exam) notFound();
  const e: any = exam;

  const [{ data: key }, { data: items }, { data: subs }, { data: enr }, { data: author }, { data: tpls }, { data: logs }] = await Promise.all([
    sb.from('exam_keys').select('answers').eq('exam_id', e.id).maybeSingle(),
    sb.from('exam_items').select('no, area, concept, fix').eq('exam_id', e.id).order('no'),
    sb.from('submissions').select('id, student_id, attempt, ox, score, n, submitted_at, students(name, student_no, guardian_phone)').eq('exam_id', e.id).order('submitted_at'),
    sb.from('enrollments').select('student_id, students(name, student_no, status)').eq('class_id', e.class_id).is('end_date', null),
    e.created_by ? sb.from('profiles').select('display_name').eq('id', e.created_by).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('message_templates').select('id, name').eq('active', true).order('created_at'),
    sb.from('message_logs').select('submission_id, status, result, sent_at').eq('exam_id', params.id).order('sent_at', { ascending: false }),
  ]);
  const aligoOk = (await aligoConfigured()).ok;
  const lastLog: Record<string, any> = {};
  (logs ?? []).forEach((l: any) => { if (l.submission_id && !lastLog[l.submission_id]) lastLog[l.submission_id] = l; });
  const sentCount = Object.values(lastLog).filter((l: any) => l.status === 'sent').length;

  const info: ItemInfo = {};
  (items ?? []).forEach((it) => { info[it.no] = { area: it.area || '', concept: it.concept || '', fix: it.fix || '' }; });
  const teacher = (author as any)?.display_name || me.name;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

  const first = (subs ?? []).filter((s: any) => s.attempt === 1);
  const retakes = (subs ?? []).filter((s: any) => s.attempt > 1);
  const done = new Set(first.map((s: any) => s.student_id));
  const roster = (enr ?? []).filter((x: any) => x.students?.status === 'active');
  const missing = roster.filter((x: any) => !done.has(x.student_id)).map((x: any) => x.students?.name).sort((a: string, b: string) => a.localeCompare(b, 'ko'));

  const results = first.map((s: any) => {
    const g = fromOx(s.ox);
    const stats = areaStats(info, g);
    const weak = weakAreas(stats);
    return {
      ...s, g, weak, point: pts(s.score, s.n),
      message: parentMessage({ name: s.students?.name ?? '', teacher, guide: e.guide || '', g, weak, url: appUrl + '/p' }),
    };
  }).sort((a: any, b: any) => b.point - a.point || new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime());
  let prev = -1, rank = 0;
  results.forEach((r: any, i: number) => { if (r.point !== prev) { rank = i + 1; prev = r.point; } r.rank = rank; });
  const avg = results.length ? Math.round((results.reduce((a: number, r: any) => a + r.point, 0) / results.length) * 10) / 10 : null;

  // 문항별 정답률 (오답이 많은 문항 찾기)
  const itemRate = Array.from({ length: e.n_items }, (_, i) => {
    const c = first.filter((s: any) => s.ox[i] === '1').length;
    return first.length ? Math.round((c / first.length) * 100) : null;
  });

  return (
    <>
      <div className="head">
        <div>
          <div className="crumb"><Link href="/staff/exams">OMR 과제</Link></div>
          <h1>{e.title}</h1>
          <div className="sub">{e.classes?.branches?.name} {e.classes?.name} · {e.n_items}문항 {e.choices}지선다 · 출제 {teacher}
            {e.opens_at ? ` · 시작 ${seoulDate(e.opens_at, 'mdhm')}` : ''}</div>
        </div>
        <div className="row">
          <Link className="btn ghost" href={`/print/omr/${e.id}`} target="_blank">OMR 답안지 인쇄</Link>
          <form action={setExamFlags}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="is_open" value={String(!e.is_open)} />
            <button className={e.is_open ? 'btn danger' : 'btn'}>{e.is_open ? '시험 닫기' : '시험 열기'}</button></form>
          <form action={setExamFlags}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="allow_retake" value={String(!e.allow_retake)} />
            <button className="btn ghost">{e.allow_retake ? '재시험 막기' : '재시험 허용'}</button></form>
        </div>
      </div>
      <Flash sp={searchParams} />

      <div className="stats">
        <div className="stat"><b>{e.is_open ? '열림' : '닫힘'}</b><span>{e.allow_retake ? '재시험 허용 중' : '1회만 제출'}</span></div>
        <div className="stat"><b>{first.length}/{roster.length}</b><span>제출 / 수강생</span></div>
        <div className="stat"><b>{avg ?? '-'}</b><span>평균 (100점)</span></div>
        <div className="stat"><b>{missing.length}</b><span>미제출</span></div>
      </div>

      {!!missing.length && (
        <div className="panel"><h3>미제출 {missing.length}명</h3><div>{missing.join(', ')}</div></div>
      )}

      <div className="panel">
        <h2>학부모 알림톡</h2>
        {!aligoOk && <div className="flash err">알리고 연결 정보가 아직 없습니다. 「연동 설정」에서 입력하세요.</div>}
        {!(tpls ?? []).length ? <p className="muted">등록된 템플릿이 없습니다. <Link href="/staff/messages">알림톡</Link> 메뉴에서 알리고 승인 템플릿을 먼저 등록하세요.</p> : (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <form action={setExamNotify} className="row">
              <input type="hidden" name="id" value={e.id} />
              <select name="template_id" defaultValue={e.notify_template_id ?? ''} aria-label="템플릿">
                <option value="">보내지 않음</option>
                {(tpls ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="checkbox" name="notify_auto" defaultChecked={e.notify_auto} /> 학생이 제출하면 바로 자동 발송</label>
              <button className="btn ghost">저장</button>
            </form>
            {e.notify_template_id && first.length > sentCount && (
              <form action={sendExamResults}><input type="hidden" name="id" value={e.id} /><SubmitButton pendingText="보내는 중…">안 보낸 {first.length - sentCount}명 일괄 발송</SubmitButton></form>
            )}
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>발송 {sentCount}/{first.length}명 · 보호자 연락처는 학생 카드에서 입력합니다. 카톡을 못 받으면 같은 내용이 문자로 갑니다.</p>
      </div>

      <div className="panel">
        <h2>결과 · 점수 순</h2>
        {!results.length ? <div className="empty">아직 제출한 학생이 없습니다.{!e.is_open && ' 시험을 열어야 학생 화면에 보입니다.'}</div> : (
          <div className="scroll">
            <table className="t">
              <thead><tr><th className="r">등수</th><th>이름</th><th className="r">점수</th><th>틀린 문항</th><th>부족한 영역</th><th>제출</th><th>알림톡</th><th>문자 문안</th></tr></thead>
              <tbody>
                {results.map((r: any) => (
                  <tr key={r.id}>
                    <td className="r num">{r.rank}</td>
                    <td><b>{r.students?.name}</b></td>
                    <td className="r num"><b>{r.point}</b> <span className="muted small">({r.score}/{r.n})</span></td>
                    <td className="num small">{r.g.wrong.join(', ') || <span className="badge good">만점</span>}</td>
                    <td className="small">{weakSummary(r.weak) || <span className="muted">-</span>}</td>
                    <td className="num small muted">{seoulDate(r.submitted_at, 'mdhm')}</td>
                    <td className="small" style={{ minWidth: 110 }}>
                      {!r.students?.guardian_phone ? <span className="badge">번호 없음</span>
                        : lastLog[r.id]?.status === 'sent' ? <span className="badge good">발송 {seoulDate(lastLog[r.id].sent_at, 'mdhm').split(' ')[1]}</span>
                        : lastLog[r.id] ? <span className="badge bad" title={lastLog[r.id].result}>실패</span>
                        : <span className="badge">미발송</span>}
                      {e.notify_template_id && r.students?.guardian_phone && (
                        <form action={resendOne}><input type="hidden" name="exam_id" value={e.id} /><input type="hidden" name="submission_id" value={r.id} />
                          <button className="btn ghost sm" style={{ marginTop: 4 }}>{lastLog[r.id]?.status === 'sent' ? '다시 보내기' : '보내기'}</button></form>
                      )}
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <CopyButton text={r.message} />
                      <details><summary className="small">보기</summary><pre className="msg">{r.message}</pre></details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!!retakes.length && (
          <details style={{ marginTop: 12 }}>
            <summary>재시험 기록 {retakes.length}건 (통계·순위는 1차 응시 기준)</summary>
            <table className="t" style={{ marginTop: 8 }}><tbody>
              {retakes.map((s: any) => <tr key={s.id}><td>{s.students?.name}</td><td>{s.attempt}차</td><td className="num">{pts(s.score, s.n)}점 ({s.score}/{s.n})</td><td className="num muted">{seoulDate(s.submitted_at, 'mdhm')}</td></tr>)}
            </tbody></table>
          </details>
        )}
      </div>

      <div className="panel">
        <h2>문항별 정답률</h2>
        <div className="scroll">
          <table className="t">
            <thead><tr><th>번호</th><th>정답</th><th>영역</th><th>핵심 개념</th><th className="r">정답률</th></tr></thead>
            <tbody>
              {itemRate.map((rate, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}</td>
                  <td>{key?.answers?.[i] ? CIRCLE.charAt(key.answers[i] - 1) : <span className="badge bad">없음</span>}</td>
                  <td>{info[i + 1]?.area}</td>
                  <td className="small">{info[i + 1]?.concept}</td>
                  <td className="r num">{rate === null ? '-' : <span className={rate < 50 ? 'badge bad' : ''}>{rate}%</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="panel">
        <summary>정답·문항정보 고치기</summary>
        <form action={updateKey} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={e.id} />
          <div style={{ marginBottom: 10 }}><KeyFileImport /></div>
          <label className="field">정답 ({e.n_items}개, 비우면 그대로)<input name="answers" placeholder={(key?.answers ?? []).map((a: number) => CIRCLE.charAt(a - 1)).join('')} /></label>
          <label className="field" style={{ marginTop: 10 }}>문항정보 (붙여넣으면 전체 교체, 비우면 그대로)<textarea name="items" /></label>
          <button className="btn" style={{ marginTop: 10 }}>저장</button>
        </form>
        {!!(subs ?? []).length && (
          <form action={regrade} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={e.id} />
            <button className="btn ghost">이미 낸 답안 {subs!.length}건 다시 채점</button>
          </form>
        )}
      </details>
    </>
  );
}
