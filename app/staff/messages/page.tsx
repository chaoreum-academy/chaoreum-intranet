import Link from 'next/link';
import { requireRole, STAFF } from '@/lib/auth';
import { Flash } from '@/components/Flash';
import { seoulDate } from '@/lib/ids';
import { aligoConfigured } from '@/lib/aligo';
import { OMR_VARS } from '@/lib/notify';
import { saveTemplate, toggleTemplate, testSend } from './actions';

export default async function MessagesPage({ searchParams }: { searchParams: { ok?: string; err?: string; edit?: string; failed?: string } }) {
  const me = await requireRole(STAFF);
  const canEdit = me.role === 'hq_admin' || me.role === 'branch_manager';
  const cfg = await aligoConfigured();
  const [{ data: tpls }, logsRes] = await Promise.all([
    me.sb.from('message_templates').select('id, name, tpl_code, subject, body, button_json, active').order('created_at'),
    (() => {
      let q = me.sb.from('message_logs').select('id, status, result, trigger, receiver, sent_at, students(id, name), exams(id, title)').order('sent_at', { ascending: false }).limit(100);
      if (searchParams.failed) q = q.neq('status', 'sent');
      return q;
    })(),
  ]);
  const logs = logsRes.data ?? [];
  const editing = (tpls ?? []).find((t) => t.id === searchParams.edit);

  return (
    <>
      <div className="head">
        <div><h1>알림톡</h1><div className="sub">알리고에서 카카오 승인을 받은 템플릿을 등록하면, OMR 결과를 학부모에게 자동으로 보냅니다.</div></div>
      </div>
      <Flash sp={searchParams} />

      <div className={'flash ' + (cfg.ok ? 'ok' : 'err')}>
        {cfg.ok ? '알리고 연결 설정이 되어 있습니다.' : `알리고 연결 정보가 아직 없습니다. 「연동 설정」 메뉴에서 입력하세요. (빠진 항목 ${cfg.missing.length}개)`}
      </div>

      {canEdit && (
        <div className="grid2">
          <div className="panel">
            <h2>{editing ? '템플릿 고치기' : '승인된 템플릿 등록'}</h2>
            <form action={saveTemplate} key={editing?.id ?? 'new'}>
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div className="row">
                <label className="field">이름 (화면용)<input name="name" defaultValue={editing?.name} placeholder="OMR 결과 안내" required /></label>
                <label className="field">템플릿 코드<input name="tpl_code" defaultValue={editing?.tpl_code} placeholder="TA_1234" required size={12} /></label>
                <label className="field">제목<input name="subject" defaultValue={editing?.subject ?? '차오름학원'} size={12} /></label>
              </div>
              <label className="field" style={{ marginTop: 10 }}>본문 — 알리고에 승인된 내용을 한 글자도 바꾸지 말고 그대로 붙여넣기
                <textarea name="body" defaultValue={editing?.body} required style={{ minHeight: 180 }} placeholder={'[차오름학원] #{학생명} 학생 복습테스트 결과\n시험: #{시험명}\n점수: #{점수}점 (#{문항수}문항 중 #{정답수}개 정답)\n틀린 문항: #{오답}\n#{리포트링크}'} />
              </label>
              <label className="field" style={{ marginTop: 10 }}>버튼 JSON (템플릿에 버튼이 있을 때만, 알리고 템플릿 화면에서 복사)
                <input name="button_json" defaultValue={editing?.button_json ?? ''} placeholder='{"button":[{"name":"결과 보기","linkType":"WL","linkM":"#{리포트링크}","linkP":"#{리포트링크}"}]}' />
              </label>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn">{editing ? '저장' : '등록'}</button>
                {editing && <Link className="btn ghost" href="/staff/messages">취소</Link>}
              </div>
            </form>
          </div>
          <div className="panel">
            <h2>자동으로 채워지는 변수</h2>
            <p className="muted small" style={{ marginTop: 0 }}>템플릿 속 <code>#{'{'}변수{'}'}</code> 이름이 아래와 같으면 자동으로 채워집니다. 승인된 템플릿의 변수 이름이 다르면 알려 주세요. 맞춰 드립니다.</p>
            <table className="t"><tbody>
              {OMR_VARS.map(([k, v]) => <tr key={k}><td className="num"><code>#{'{'}{k}{'}'}</code></td><td className="small muted">{v}</td></tr>)}
            </tbody></table>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>등록된 템플릿</h2>
        {!tpls?.length ? <div className="empty">아직 없습니다.{canEdit ? ' 위에서 알리고에 승인된 템플릿을 등록하세요.' : ''}</div> : (
          <table className="t">
            <thead><tr><th>이름</th><th>코드</th><th>본문</th><th>상태</th>{canEdit && <th>테스트</th>}</tr></thead>
            <tbody>
              {tpls.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.name}</b>{canEdit && <div><Link className="small" href={`/staff/messages?edit=${t.id}`}>고치기</Link></div>}</td>
                  <td className="num small">{t.tpl_code}</td>
                  <td><pre className="msg" style={{ maxHeight: 120, overflow: 'auto', margin: 0 }}>{t.body}</pre></td>
                  <td>{canEdit ? (
                    <form action={toggleTemplate}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={String(!t.active)} />
                      <button className={t.active ? 'btn ghost sm' : 'btn sm'}>{t.active ? '사용 중' : '중지됨'}</button></form>
                  ) : <span className={'badge ' + (t.active ? 'good' : '')}>{t.active ? '사용 중' : '중지'}</span>}</td>
                  {canEdit && (
                    <td>
                      <form action={testSend} className="row"><input type="hidden" name="id" value={t.id} />
                        <input name="phone" placeholder="010-0000-0000" size={13} inputMode="tel" required />
                        <button className="btn ghost sm">내 번호로 테스트</button></form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="head" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>발송 기록</h2>
          <Link className="btn ghost sm" href={searchParams.failed ? '/staff/messages' : '/staff/messages?failed=1'}>{searchParams.failed ? '전체 보기' : '실패만 보기'}</Link>
        </div>
        {!logs.length ? <div className="empty">발송 기록이 없습니다.</div> : (
          <div className="scroll">
            <table className="t">
              <thead><tr><th>시각</th><th>학생</th><th>시험</th><th>받는 번호</th><th>결과</th><th>방식</th></tr></thead>
              <tbody>
                {logs.map((l: any) => (
                  <tr key={l.id}>
                    <td className="num small">{seoulDate(l.sent_at, 'mdhm')}</td>
                    <td>{l.students ? <Link href={`/staff/students/${l.students.id}`}>{l.students.name}</Link> : '-'}</td>
                    <td className="small">{l.exams ? <Link href={`/staff/exams/${l.exams.id}`}>{l.exams.title}</Link> : '-'}</td>
                    <td className="num small">{l.receiver ?? '-'}</td>
                    <td><span className={'badge ' + (l.status === 'sent' ? 'good' : l.status === 'failed' ? 'bad' : '')}>{l.status === 'sent' ? '발송' : l.status === 'failed' ? '실패' : '건너뜀'}</span> <span className="small muted">{l.status !== 'sent' ? l.result : ''}</span></td>
                    <td className="small">{l.trigger === 'auto' ? '자동' : l.trigger === 'test' ? '테스트' : '수동'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
