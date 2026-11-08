import { requireRole } from '@/lib/auth';
import { Flash } from '@/components/Flash';
import { getSettings, mask, ALIGO_KEYS, clearSettingsCache } from '@/lib/settings';
import { saveAligo, testAligo } from './actions';

const LABEL: Record<string, [string, string]> = {
  ALIGO_API_KEY: ['API 키', '알리고 → API 신청/관리 화면의 인증키'],
  ALIGO_USER_ID: ['알리고 아이디', '알리고 로그인 아이디'],
  ALIGO_SENDER_KEY: ['발신프로필 키', '알리고 → 카카오톡 → 발신프로필 관리의 senderkey'],
  ALIGO_SENDER: ['발신번호', '알리고에 등록된 학원 전화번호'],
};

export default async function SettingsPage({ searchParams }: { searchParams: { ok?: string; err?: string } }) {
  const me = await requireRole(['hq_admin']);
  clearSettingsCache();
  const cfg = await getSettings();
  const { data: branches } = await me.sb.from('branches').select('id, name').order('sort');
  const filled = ALIGO_KEYS.filter((k) => cfg[k]).length;

  return (
    <>
      <div className="head"><div><h1>연동 설정</h1><div className="sub">본사 관리자만 볼 수 있습니다. 저장한 키는 앞뒤 일부만 표시됩니다.</div></div></div>
      <Flash sp={searchParams} />
      <div className="grid3">
        <div className="panel">
          <div className="phead">
            <h2>알리고 (카카오 알림톡·문자)</h2>
            <span className={'badge ' + (filled === 4 ? 'good' : 'warn')}>{filled === 4 ? '입력 완료' : `${filled}/4 입력`}</span>
          </div>
          <form action={saveAligo}>
            {ALIGO_KEYS.map((k) => (
              <label key={k} className="field" style={{ marginBottom: 12 }}>
                <span>{LABEL[k][0]} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>· {LABEL[k][1]}</span></span>
                <input name={k} type={k === 'ALIGO_SENDER' || k === 'ALIGO_USER_ID' ? 'text' : 'password'} autoComplete="off"
                  placeholder={cfg[k] ? `저장됨 ${mask(cfg[k])} (바꿀 때만 입력)` : '입력'} />
              </label>
            ))}
            <div className="row"><button className="btn">저장</button></div>
          </form>
          <form action={testAligo} style={{ marginTop: 10 }}><button className="btn ghost">연결 확인 (메시지는 보내지 않음)</button></form>
        </div>
        <div className="panel">
          <h2>지점</h2>
          <table className="t"><tbody>{(branches ?? []).map((b) => <tr key={b.id}><td>{b.name}</td></tr>)}</tbody></table>
          <p className="muted small">지점 추가·이름 변경이 필요하면 알려 주세요.</p>
        </div>
      </div>
    </>
  );
}
