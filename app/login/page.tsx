import { login } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';

export default function LoginPage({ searchParams }: { searchParams: { err?: string } }) {
  return (
    <div className="login">
      <div className="art">
        <b>차오름학원</b>
        <p>출결, 과제와 OMR 채점, 클리닉, 학부모 알림까지 한 곳에서 관리합니다.</p>
        <small>철산1관 · 철산2관 · 하안관 · 논술관 · 사회과학관</small>
      </div>
      <div className="formside">
        <form className="box" action={login}>
          <h1>로그인</h1>
          <div className="sub">학생은 학번, 선생님·학부모님은 이메일로 로그인합니다.</div>
          {searchParams.err && <div className="flash err">{searchParams.err}</div>}
          <label htmlFor="id">학번 또는 이메일</label>
          <input id="id" name="id" autoComplete="username" required />
          <label htmlFor="pw">비밀번호</label>
          <input id="pw" name="password" type="password" autoComplete="current-password" required />
          <SubmitButton pendingText="로그인 중…">로그인</SubmitButton>
          <div className="hint">비밀번호를 모르면 담당 선생님이나 데스크에 초기화를 요청하세요.</div>
        </form>
      </div>
    </div>
  );
}
